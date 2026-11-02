import { askConfirm } from "@/components/ui/overlay";
import { FrameworkBadge } from "@/components/frameworkBadge";
import { useT } from "@/lib/i18n";
import { CompanyCell, useGroupView } from "@/components/company";
import { STATUS_COLORS } from "@/components/health";
import { PositionSelect } from "@/components/pickers";
import { RiskLevelBadge } from "@/components/risk";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useMe } from "@/lib/auth";
import { cn, fmtDay } from "@/lib/utils";
import {
  CYCLE_LABELS,
  CYCLE_REASONS,
  fmtCzk,
  type CycleCompareRow,
  type CycleDetail,
  type CycleItemSnapshot,
  type CycleItemState,
  type CycleKind,
  type CycleReason,
  type CycleStatus,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Minus, Plus } from "lucide-react";
import { useState } from "react";

const statusTone: Record<CycleStatus, Tone> = { in_progress: "blue", review: "amber", approved: "green", cancelled: "slate" };
const itemTone: Record<CycleItemState, Tone> = { pending: "amber", reassessed: "blue", confirmed: "green", excluded: "slate" };
const BACK: Record<CycleKind, { to: string; label: string }> = { risk: { to: "/risks", label: "Rizika" }, bia: { to: "/bia", label: "Kontinuita" } };

function Progress({ counts, total }: { counts: Record<CycleItemState, number>; total: number }) {
  const t = useT();
  const done = counts.reassessed + counts.confirmed;
  return (
    <div className="w-40">
      <div className="flex h-2 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={t("cyc.rozhodnutoZ", { done: done, total: total })}>
        {total > 0 && <div style={{ width: `${(done / total) * 100}%`, background: STATUS_COLORS.good }} />}
      </div>
      <div className="mt-1 text-xs text-slate-500">
        {done}/{total} {t("cyc.rozhodnuto")}{counts.excluded ? (" " + t("cyc.vyrazeno", { excluded: counts.excluded })) : ""}
      </div>
    </div>
  );
}

/** Seznam hodnotících cyklů (roční hodnocení rizik / BIA). */
export function CyclesPage({ kind }: { kind: CycleKind }) {
  const t = useT();
  const can = useCan();
  const group = useGroupView();
  const write = can(kind === "risk" ? "risks:write" : "bia:write");
  const list = useQuery({ queryKey: ["cycles", kind], queryFn: () => api.cycles.list(kind) });
  const status = useQuery({ queryKey: ["cycles", kind, "status"], queryFn: () => api.cycles.status(kind) });
  const [create, setCreate] = useState(false);
  const me = useMe();
  const nameOf = (id: string) => me.companies.find((c) => c.id === id)?.name ?? "";
  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to={BACK[kind].to as never} className="hover:text-brand-700">
          {t.lbl(BACK[kind].label)}
        </Link>
      </div>
      <PageHeader badge={<FrameworkBadge />}
        title={kind === "risk" ? t("cyc.pravidelneHodnoceniRizik") : t("cyc.pravidelnaAnalyzaDopaduBia")}
        subtitle={
          kind === "risk"
            ? t("cyc.8Odst1PismC")
            : t("cyc.analyzaDopaduSePravidelneRocne")
        }
        actions={
          write && (
            <Button onClick={() => setCreate(true)}>
              <Plus size={16} /> {t("cyc.zahajitHodnoceni")}
            </Button>
          )
        }
      />
      <ErrorBox error={list.error ?? status.error} />
      {(status.data ?? []).length > 0 && (
        <div className="mb-6 flex flex-wrap gap-3">
          {(status.data ?? []).map((s) => (
            <Card key={s.companyId} className="min-w-64 px-4 py-3">
              {group && <div className="mb-1 text-xs font-medium text-slate-500">{nameOf(s.companyId)}</div>}
              <div className="text-sm">
                {t("cyc.posledniSchvalene")} <b>{s.lastApprovedAt ? fmtDay(s.lastApprovedAt) : t("cyc.dosudZadne")}</b>
              </div>
              <div className={cn("text-sm", s.overdue && !s.runningId ? "font-medium text-red-700" : "text-slate-600")}>
                {s.runningId ? t("cyc.hodnoceniPraveProbiha") : s.nextDue ? t("cyc.dalsiDo", { p: fmtDay(s.nextDue) }) : t("cyc.provedtePrvniHodnoceni")}
                {s.overdue && !s.runningId && <AlertTriangle size={13} className="ml-1 inline" color={STATUS_COLORS.critical} />}
              </div>
            </Card>
          ))}
        </div>
      )}
      <Card className="overflow-hidden">
        {(list.data ?? []).length === 0 ? (
          <EmptyState>{list.isLoading ? t("common.loading") : t("cyc.zatimZadneHodnoceni")}</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2">{t("cyc.hodnoceni")}</th>
                <th className="px-3 py-2">{t("cyc.duvod")}</th>
                <th className="px-3 py-2">{t("cyc.prubeh")}</th>
                <th className="px-3 py-2">{t("cyc.termin")}</th>
                <th className="px-3 py-2">{t("cyc.schvaleno")}</th>
                <th className="px-3 py-2">{t("cyc.stav")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(list.data ?? []).map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-5 py-2.5">
                    <Link to="/cycles/$cycleId" params={{ cycleId: c.id }} className="font-medium hover:text-brand-700">
                      {c.title}
                    </Link>
                    {group && (
                      <div>
                        <CompanyCell id={c.companyId} />
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">{t.lbl(CYCLE_LABELS.reason[c.reason])}</td>
                  <td className="px-3 py-2.5">
                    <Progress counts={c.counts} total={c.total} />
                  </td>
                  <td className={cn("px-3 py-2.5 whitespace-nowrap", c.overdue ? "font-medium text-red-700" : "text-slate-600")}>{c.dueDate ? fmtDay(c.dueDate) : "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">{c.approvedAt ? fmtDay(c.approvedAt) : "—"}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={statusTone[c.status]}>{t.lbl(CYCLE_LABELS.status[c.status])}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {create && <CreateModal kind={kind} onClose={() => setCreate(false)} />}
    </>
  );
}

function CreateModal({ kind, onClose }: { kind: CycleKind; onClose: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const y = new Date().getFullYear();
  const [f, setF] = useState({ title: `${kind === "risk" ? t("cyc.hodnoceniRizik") : t("cyc.analyzaDopadu")} ${y}`, reason: "regular" as CycleReason, dueDate: "", periodFrom: `${y}-01-01`, periodTo: `${y}-12-31`, leaderPositionId: null as string | null, team: "", scope: "" });
  const m = useMutation({
    mutationFn: () => api.cycles.create({ kind, ...f, dueDate: f.dueDate || null, team: f.team || null, scope: f.scope || null }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["cycles"] });
      nav({ to: "/cycles/$cycleId", params: { cycleId: d.id } });
    },
  });
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("cyc.zahajitHodnoceni")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={!f.title.trim() || m.isPending} onClick={() => m.mutate()}>
            {t("cyc.zahajit")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">
        {t("cyc.doRozsahuSeZaradiVsechna")} {kind === "risk" ? t("cyc.otevrenaRizika") : "BIA"} {t("cyc.aktivniSpolecnostiNoveZalozenePolozky")}
      </p>
      <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
        <Field label={t("cyc.nazev")}>
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label={t("cyc.duvod")}>
          <Select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value as CycleReason })}>
            {CYCLE_REASONS.map((r) => (
              <option key={r} value={r}>
                {t.lbl(CYCLE_LABELS.reason[r])}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("cyc.hodnoceneObdobiOd")}>
          <Input type="date" value={f.periodFrom} onChange={(e) => setF({ ...f, periodFrom: e.target.value })} />
        </Field>
        <Field label={t("cyc.do")}>
          <Input type="date" value={f.periodTo} onChange={(e) => setF({ ...f, periodTo: e.target.value })} />
        </Field>
        <Field label={t("cyc.terminDokonceni")}>
          <Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
        </Field>
      </div>
      <Field label={t("cyc.vedeFunkcniMisto")}>
        <PositionSelect value={f.leaderPositionId} onChange={(v) => setF({ ...f, leaderPositionId: v })} />
      </Field>
      <Field label={t("cyc.tym")}>
        <Input value={f.team} onChange={(e) => setF({ ...f, team: e.target.value })} placeholder={t("cyc.naprMkbGarantiAktivVlastnici")} />
      </Field>
      <Field label={t("cyc.rozsahAVstupy")}>
        <Textarea rows={2} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} />
      </Field>
      <ErrorBox error={m.error} />
    </Modal>
  );
}

const snapText = (kind: CycleKind, s: CycleItemSnapshot | null) => {
  if (!s) return <span className="text-slate-400">—</span>;
  if (kind === "risk")
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <RiskLevelBadge level={s.level ?? null} score={s.score} />
        {s.levelLabel && <span className="text-xs text-slate-500">{s.levelLabel}</span>}
        {s.ale != null && <span className="text-xs text-slate-500">· {fmtCzk(s.ale)}/rok</span>}
      </span>
    );
  return (
    <span className="text-xs text-slate-600 tabular-nums">
      dopad {s.maxImpact ?? "—"} · RTO {s.rtoHours ?? "—"} h · RPO {s.rpoHours ?? "—"} h
    </span>
  );
};

const CHANGE = {
  worse: { label: "Zhoršení", icon: ArrowUp, color: STATUS_COLORS.critical },
  better: { label: "Zlepšení", icon: ArrowDown, color: STATUS_COLORS.good },
  new: { label: "Nové", icon: Plus, color: "#2a78d6" },
  removed: { label: "Odebráno", icon: Minus, color: STATUS_COLORS.neutral },
  same: { label: "Beze změny", icon: Minus, color: STATUS_COLORS.neutral },
} as const;

export function CycleDetailPage() {
  const { cycleId } = useParams({ strict: false }) as { cycleId: string };
  const q = useQuery({ queryKey: ["cycles", "detail", cycleId], queryFn: () => api.cycles.get(cycleId) });
  if (!q.data) return <ErrorBox error={q.error} />;
  return <CycleView d={q.data} />;
}

function CycleView({ d }: { d: CycleDetail }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"items" | "compare">("items");
  const [filter, setFilter] = useState<"all" | "pending">(d.status === "in_progress" ? "pending" : "all");
  const [exclude, setExclude] = useState<string | null>(null);
  const cmp = useQuery({ queryKey: ["cycles", "compare", d.id], queryFn: () => api.cycles.compare(d.id), enabled: tab === "compare" });
  const set = (x: CycleDetail) => {
    qc.setQueryData(["cycles", "detail", x.id], x);
    qc.invalidateQueries({ queryKey: ["cycles", d.kind] });
    qc.invalidateQueries({ queryKey: ["cycles", "compare", x.id] });
  };
  const decide = useMutation({ mutationFn: (v: { id: string; state: "confirmed" | "excluded" | "pending"; note?: string }) => api.cycles.decide(d.id, v.id, v.state, v.note), onSuccess: set });
  const submit = useMutation({ mutationFn: () => api.cycles.submit(d.id), onSuccess: set });
  const reopen = useMutation({ mutationFn: () => api.cycles.reopen(d.id), onSuccess: set });
  const approve = useMutation({ mutationFn: () => api.cycles.approve(d.id), onSuccess: set });
  const cancel = useMutation({ mutationFn: () => api.cycles.cancel(d.id), onSuccess: set });
  const items = d.items.filter((i) => filter === "all" || i.state === "pending");
  const running = d.status === "in_progress";
  const link = (id: string) => (d.kind === "risk" ? { to: "/risks/$riskId" as const, params: { riskId: id } } : { to: "/bia/$biaId" as const, params: { biaId: id } });
  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to={d.kind === "risk" ? "/risks/cycles" : "/bia/cycles"} className="hover:text-brand-700">
          {d.kind === "risk" ? t("cyc.pravidelneHodnoceniRizik") : t("cyc.pravidelnaAnalyzaDopadu")}
        </Link>
      </div>
      <PageHeader
        title={d.title}
        subtitle={`${t.lbl(CYCLE_LABELS.kind[d.kind])} · ${t.lbl(CYCLE_LABELS.reason[d.reason])}${d.changeTitle ? ` (${d.changeTitle})` : ""} · ${t("cyc.zahajenoDne", { date: fmtDay(d.startedAt) })}${d.dueDate ? (" " + t("cyc.termin2", { p: fmtDay(d.dueDate) })) : ""}${d.leaderPositionName ? ` · ${t("cyc.vede", { p: d.leaderPositionName })}` : ""}`}
        actions={
          <>
            <Badge tone={statusTone[d.status]}>{t.lbl(CYCLE_LABELS.status[d.status])}</Badge>
            {d.canEdit && running && (
              <Button variant="secondary" onClick={async () => (await askConfirm(t("cyc.zrusitHodnoceni"))) && cancel.mutate()}>
                {t("common.cancelAction")}
              </Button>
            )}
            {d.canEdit && running && (
              <Button disabled={d.counts.pending > 0 || submit.isPending} onClick={() => submit.mutate()} title={d.counts.pending ? t("cyc.nejdrivRozhodneteVsechnyPolozky") : undefined}>
                {t("cyc.predatKeSchvaleni")}
              </Button>
            )}
            {d.status === "review" && d.canEdit && (
              <Button variant="secondary" onClick={() => reopen.mutate()}>
                {t("cyc.vratitKUpravam")}
              </Button>
            )}
            {d.status === "review" && can("documents:approve") && (
              <Button disabled={approve.isPending} onClick={async () => (await askConfirm(t("cyc.schvalitHodnoceniVysledekSeZmrazi"))) && approve.mutate()}>
                {t("cyc.schvalit")}
              </Button>
            )}
          </>
        }
      />
      <ErrorBox error={decide.error ?? submit.error ?? reopen.error ?? approve.error ?? cancel.error} />
      {d.approvedAt && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
          <CheckCircle2 size={15} color={STATUS_COLORS.good} /> {t("cyc.schvaleno")} {fmtDay(d.approvedAt)}
          {d.approvedByName ? ` (${d.approvedByName})` : ""}
          {d.approvalNote ? ` – ${d.approvalNote}` : ""}
        </div>
      )}
      <div className="mb-4 grid gap-4 sm:grid-cols-4">
        {(["pending", "reassessed", "confirmed", "excluded"] as const).map((s) => (
          <Card key={s} className="px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">{t.lbl(CYCLE_LABELS.item[s])}</div>
            <div className="text-2xl font-semibold tabular-nums">{d.counts[s]}</div>
          </Card>
        ))}
      </div>
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {(
          [
            ["items", t("cyc.polozky")],
            ["compare", d.previousId ? t("cyc.porovnaniSPredchozim") : t("cyc.zmenyOdZahajeni")],
          ] as const
        ).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cn("-mb-px border-b-2 px-4 py-2 text-sm", tab === k ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-slate-600")}>
            {l}
          </button>
        ))}
      </div>
      {tab === "items" ? (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <div className="text-sm text-slate-600">
              {running
                ? d.kind === "risk"
                  ? t("cyc.upravteHodnoceniRizikaVJeho")
                  : t("cyc.aktualizujteBiaZapiseSeJako")
                : t("cyc.stavPolozekPriSchvaleni")}
            </div>
            <div className="flex rounded-md border border-slate-300 p-0.5 text-xs">
              {(
                [
                  ["pending", t("cyc.cekajici")],
                  ["all", t("common.all")],
                ] as const
              ).map(([k, l]) => (
                <button key={k} onClick={() => setFilter(k)} className={cn("rounded px-2 py-1", filter === k ? "bg-brand-50 text-brand-700" : "text-slate-600")}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          {items.length === 0 ? (
            <EmptyState>{filter === "pending" ? t("cyc.vsechnyPolozkyJsouRozhodnute") : t("cyc.rozsahJePrazdny")}</EmptyState>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2">{d.kind === "risk" ? "Riziko" : t("cyc.procesBia")}</th>
                  <th className="px-3 py-2">{t("cyc.priZahajeni")}</th>
                  <th className="px-3 py-2">{d.status === "approved" ? t("cyc.schvaleno") : t("cyc.aktualne")}</th>
                  <th className="px-3 py-2">{t("cyc.stav")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((i) => (
                  <tr key={i.entityId}>
                    <td className="px-5 py-2.5">
                      <Link {...link(i.entityId)} className="font-medium hover:text-brand-700">
                        {i.code && <span className="mr-1.5 text-slate-500">{i.code}</span>}
                        {i.name}
                      </Link>
                      {i.note && <div className="text-xs text-slate-500">{i.note}</div>}
                    </td>
                    <td className="px-3 py-2.5">{snapText(d.kind, i.before)}</td>
                    <td className="px-3 py-2.5">{snapText(d.kind, d.status === "approved" ? i.after : (i.current ?? i.after))}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={itemTone[i.state]}>{t.lbl(CYCLE_LABELS.item[i.state])}</Badge>
                      {i.decidedAt && (
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          {fmtDay(i.decidedAt)} {i.decidedByName ?? ""}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {d.canEdit && running && i.state === "pending" && d.kind === "risk" && i.current && i.current.score == null && (
                        <Link {...link(i.entityId)} className="mr-2 text-xs font-medium text-brand-700 hover:underline">
                          {t("cyc.ohodnotit")}
                        </Link>
                      )}
                      {d.canEdit && running && i.state === "pending" && !(d.kind === "risk" && i.current && i.current.score == null) && (
                        <>
                          <Button className="px-2 py-1 text-xs" disabled={decide.isPending} onClick={() => decide.mutate({ id: i.entityId, state: "confirmed" })}>
                            {t("cyc.potvrditBezeZmeny")}
                          </Button>
                          <button className="ml-2 text-xs text-slate-500 hover:text-slate-800" onClick={() => setExclude(i.entityId)}>
                            {t("cyc.vyradit")}
                          </button>
                        </>
                      )}
                      {d.canEdit && running && i.state !== "pending" && (
                        <button className="text-xs text-slate-500 hover:text-slate-800" onClick={() => decide.mutate({ id: i.entityId, state: "pending" })}>
                          {t("cyc.vratit")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : (
        <CompareTable kind={d.kind} rows={cmp.data?.rows ?? []} loading={cmp.isLoading} hasPrevious={!!d.previousId} />
      )}
      {exclude && <ExcludeModal onClose={() => setExclude(null)} onSave={(note) => decide.mutate({ id: exclude, state: "excluded", note }, { onSuccess: () => setExclude(null) })} />}
    </>
  );
}

function CompareTable({ kind, rows, loading, hasPrevious }: { kind: CycleKind; rows: CycleCompareRow[]; loading: boolean; hasPrevious: boolean }) {
  const t = useT();
  const counts = rows.reduce((m, r) => ({ ...m, [r.change]: (m[r.change] ?? 0) + 1 }), {} as Record<string, number>);
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={hasPrevious ? t("cyc.porovnaniSPredchozimSchvalenymHodnocenim") : t("cyc.zmenyOdZahajeniHodnoceni")}
        subtitle={Object.entries(CHANGE)
          .filter(([k]) => counts[k])
          .map(([k, v]) => `${t.lbl(v.label)}: ${counts[k]}`)
          .join(" · ")}
      />
      {loading ? (
        <EmptyState>{t("common.loading")}</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState>{t("cyc.bezPolozek")}</EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2">{t("cyc.polozka")}</th>
              <th className="px-3 py-2">{t("cyc.drive")}</th>
              <th className="px-3 py-2">{t("cyc.nyni")}</th>
              <th className="px-3 py-2">{t("cyc.zmena")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const c = CHANGE[r.change];
              const Icon = c.icon;
              return (
                <tr key={r.entityId}>
                  <td className="px-5 py-2.5">
                    {r.code && <span className="mr-1.5 text-slate-500">{r.code}</span>}
                    {r.name}
                  </td>
                  <td className="px-3 py-2.5">{snapText(kind, r.before)}</td>
                  <td className="px-3 py-2.5">{snapText(kind, r.after)}</td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1 text-xs text-slate-700">
                      <Icon size={13} color={c.color} /> {t.lbl(c.label)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function ExcludeModal({ onClose, onSave }: { onClose: () => void; onSave: (note: string) => void }) {
  const t = useT();
  const [note, setNote] = useState("");
  return (
    <Modal
      open
      onClose={onClose}
      title={t("cyc.vyraditZRozsahu")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={!note.trim()} onClick={() => onSave(note.trim())}>
            {t("cyc.vyradit")}
          </Button>
        </>
      }
    >
      <Field label={t("cyc.zduvodneni")}>
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("cyc.naprAktivumVyrazenoZProvozu")} />
      </Field>
    </Modal>
  );
}
