import { askConfirm } from "@/components/ui/overlay";
/**
 * Legislativa (v0.34, EU v0.39): sledované předpisy z e-Sbírky a EUR-Lex a ručně vedené normy, nová znění, rozdíly,
 * posouzení dopadu odpovědnou osobou, dotčené požadavky / opatření / dokumenty a úkoly.
 */
import { FrameworkOptions } from "@/components/frameworkOptions";
import { useT } from "@/lib/i18n";
import { AiSuggestPanel } from "@/components/ai";
import { PositionSelect } from "@/components/pickers";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, SuccessBox, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { cn, fmtDate, fmtDay, plural } from "@/lib/utils";
import {
  eurlexUrl,
  parseEuStaleUrl,
  type EuLang,
  LEGAL_IMPACTS,
  LEGAL_LABELS,
  type LegalActDto,
  type MsgKey,
  type Translate,
  type LegalDiffItem,
  type LegalImpact,
  type LegalReviewDetail,
  type LegalReviewStatus,
  type LegalTaskDto,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { AlertTriangle, CalendarClock, CheckCircle2, ExternalLink, FileDiff, ListChecks, Plus, RefreshCw, Scale, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

/** Popisek výčtu Legislativy v jazyce uživatele (výchozí český text z LEGAL_LABELS). */
const LL = <G extends keyof typeof LEGAL_LABELS>(t: Translate, group: G, v: keyof (typeof LEGAL_LABELS)[G] & string) =>
  t.dyn(`enum.legal.${group}.${v}`, (LEGAL_LABELS[group] as Record<string, string>)[v]!);

const reviewTone: Record<LegalReviewStatus, Tone> = { new: "amber", in_review: "blue", assessed: "green", closed: "slate" };
const impactTone: Record<LegalImpact, Tone> = { none: "slate", low: "green", medium: "amber", high: "red" };
const today = () => new Date().toISOString().slice(0, 10);
const fmtTime = (s: string | null) => (s ? fmtDate(s) : "—");

export function LegislationPage() {
  const t = useT();
  const can = useCan();
  const [tab, setTab] = useState<"acts" | "reviews" | "tasks">("acts");
  const [adding, setAdding] = useState(false);
  const acts = useQuery({ queryKey: ["legislation", "acts"], queryFn: api.legislation.acts });
  const reviews = useQuery({ queryKey: ["legislation", "reviews", "open"], queryFn: () => api.legislation.reviews("open") });
  const tasks = useQuery({ queryKey: ["legislation", "tasks", false], queryFn: () => api.legislation.tasks(false) });
  const td = today();
  const open = reviews.data?.length ?? 0;
  const overdue = (reviews.data ?? []).filter((r) => r.dueDate && r.dueDate < td).length;
  const openTasks = tasks.data?.length ?? 0;
  const overdueTasks = (tasks.data ?? []).filter((x) => x.dueDate && x.dueDate < td).length;
  const next = (acts.data ?? [])
    .filter((a) => a.currentVersion?.effectiveFrom && a.currentVersion.effectiveFrom > td)
    .sort((a, b) => a.currentVersion!.effectiveFrom!.localeCompare(b.currentVersion!.effectiveFrom!))[0];
  const problems = (acts.data ?? []).filter((a) => a.lastStatus === "error" || a.repeal || (a.watch && !a.watch.ownerPositionId)).length;
  return (
    <>
      <PageHeader
        title={t("nav.legislation")}
        subtitle={t("leg.subtitle")}
        actions={
          can("legislation:write") && (
            <Button onClick={() => setAdding(true)}>
              <Plus size={15} /> {t("leg.addAct")}
            </Button>
          )
        }
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={<Scale size={16} />} label={t("leg.kpi.acts")} value={acts.data?.length ?? "–"} note={problems ? t("leg.kpi.attention", { n: problems }) : t("leg.kpi.allOk")} tone={problems ? "amber" : "slate"} onClick={() => setTab("acts")} />
        <Kpi icon={<FileDiff size={16} />} label={t("leg.kpi.reviews")} value={open} note={overdue ? t("leg.kpi.overdue", { n: overdue }) : open ? t("leg.kpi.onTime") : t("leg.kpi.nothing")} tone={overdue ? "red" : open ? "amber" : "slate"} onClick={() => setTab("reviews")} />
        <Kpi icon={<ListChecks size={16} />} label={t("leg.kpi.tasks")} value={openTasks} note={overdueTasks ? t("leg.kpi.overdue", { n: overdueTasks }) : openTasks ? t("leg.kpi.onTime") : t("leg.kpi.none")} tone={overdueTasks ? "red" : "slate"} onClick={() => setTab("tasks")} />
        <Kpi
          icon={<CalendarClock size={16} />}
          label={t("leg.kpi.nextAmendment")}
          value={next ? fmtDay(next.currentVersion!.effectiveFrom) : "–"}
          note={next ? next.code : t("leg.kpi.noAmendment")}
          tone={next ? "blue" : "slate"}
        />
      </div>
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {(
          [
            ["acts", t("leg.tab.acts"), acts.data?.length ?? 0],
            ["reviews", t("leg.tab.reviews"), open],
            ["tasks", t("leg.tab.tasks"), openTasks],
          ] as const
        ).map(([k, l, n]) => (
          <button key={k} onClick={() => setTab(k)} className={cn("-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm", tab === k ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900")}>
            {l}
            {n > 0 && <span className={cn("rounded-full px-1.5 text-xs", tab === k ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-600")}>{n}</span>}
          </button>
        ))}
      </div>
      {tab === "acts" ? <ActsTab onAdd={() => setAdding(true)} /> : tab === "reviews" ? <ReviewsTab /> : <TasksTab />}
      <AddActModal open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

const kpiTone: Record<"slate" | "amber" | "red" | "blue", string> = {
  slate: "text-slate-500",
  amber: "text-amber-700",
  red: "text-red-700",
  blue: "text-blue-700",
};
function Kpi({ icon, label, value, note, tone, onClick }: { icon: React.ReactNode; label: string; value: React.ReactNode; note: string; tone: keyof typeof kpiTone; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={cn("rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm", onClick && "transition hover:border-brand-300 hover:shadow")}>
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        {icon} {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      <div className={cn("mt-0.5 text-xs", kpiTone[tone])}>{note}</div>
    </Tag>
  );
}

/** Stav předpisu jedním štítkem – od nejzávažnějšího. */
function actState(t: Translate, a: LegalActDto): { tone: Tone; label: string; hint?: string } {
  if (a.lastStatus === "error") return { tone: "red", label: t("leg.state.error"), hint: a.lastError ?? undefined };
  if (a.repeal) return { tone: "red", label: t("leg.state.repeal", { date: a.repeal.date ? fmtDay(a.repeal.date) : "" }).trim(), hint: a.repeal.title };
  if (a.openReviews > 0) return { tone: "amber", label: t("leg.state.reviews", { n: a.openReviews }) };
  if (a.lastStatus === "ok" && a.lastError) return { tone: "blue", label: t("leg.state.waitingText"), hint: a.lastError };
  if (!a.currentVersion) return { tone: "slate", label: t("leg.state.pending") };
  if (a.currentVersion.effectiveFrom && a.currentVersion.effectiveFrom > today()) return { tone: "blue", label: t("leg.state.amendment", { date: fmtDay(a.currentVersion.effectiveFrom) }) };
  return { tone: "green", label: t("leg.state.current") };
}

function ActsTab({ onAdd }: { onAdd: () => void }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["legislation", "status"], queryFn: api.legislation.status });
  const acts = useQuery({ queryKey: ["legislation", "acts"], queryFn: api.legislation.acts });
  const unwatch = useMutation({ mutationFn: (id: string) => api.legislation.unwatch(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["legislation"] }) });
  const write = can("legislation:write");
  return (
    <div className="space-y-4">
      {status.data?.source === "off" && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{t("leg.sourceOff")}</span>
        </div>
      )}
      <ErrorBox error={acts.error ?? unwatch.error} />
      <Card className="overflow-hidden">
        {(acts.data ?? []).length === 0 ? (
          <div className="px-5 py-12 text-center">
            <Scale size={28} className="mx-auto text-slate-300" />
            <p className="mt-3 text-sm text-slate-600">{acts.isLoading ? t("common.loading") : t("leg.noActs")}</p>
            {write && !acts.isLoading && (
              <Button className="mt-4" onClick={onAdd}>
                <Plus size={15} /> {t("leg.addFirst")}
              </Button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2.5">{t("leg.col.act")}</th>
                <th className="px-3 py-2.5">{t("leg.col.state")}</th>
                <th className="px-3 py-2.5">{t("leg.col.version")}</th>
                <th className="px-3 py-2.5">{t("leg.col.owner")}</th>
                <th className="px-3 py-2.5">{t("leg.col.checked")}</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {acts.data!.map((a) => {
                const st = actState(t, a);
                return (
                  <tr key={a.id} className="group hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", SRC_TONE[a.source])}>{t(`leg.src.short.${a.source}`)}</span>
                        <Link to="/legislation/acts/$actId" params={{ actId: a.id }} className="font-medium hover:text-brand-700">
                          {a.code}
                        </Link>
                      </div>
                      <div className="mt-0.5 line-clamp-1 text-xs text-slate-500">{a.title}</div>
                    </td>
                    <td className="px-3 py-3" title={st.hint}>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {a.currentVersion ? (
                        <>
                          <div className="font-medium text-slate-700">{versionName(t, a.currentVersion.label)}</div>
                          {a.currentVersion.effectiveFrom && <div className="text-slate-500">{t("leg.effectiveFrom", { date: fmtDay(a.currentVersion.effectiveFrom) })}</div>}
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {a.watch?.ownerPositionName ?? (
                        <span className="inline-flex items-center gap-1 text-amber-700">
                          <AlertTriangle size={12} /> {t("leg.unassigned")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-500">{a.lastCheckedAt ? fmtDate(a.lastCheckedAt) : "—"}</td>
                    <td className="px-3 py-3 text-right">
                      {write && a.watch && a.source !== "manual" && (
                        <Button variant="ghost" className="px-1.5 py-1 opacity-0 group-hover:opacity-100" onClick={async () => (await askConfirm(t("leg.unwatchConfirm", { code: a.code }))) && unwatch.mutate(a.id)} aria-label={t("leg.unwatch")}>
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      {status.data && status.data.source !== "off" && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500" data-testid="leg-source">
          <span>{t("leg.sourceInfo", { source: status.data.sourceLabel })}</span>
          {can("admin:settings") && <TextSourceSelect value={status.data.mode} apiConfigured={status.data.apiConfigured} />}
        </div>
      )}
    </div>
  );
}

const SRC_TONE: Record<LegalActDto["source"], string> = { esbirka: "bg-blue-50 text-blue-700", eurlex: "bg-amber-50 text-amber-800", manual: "bg-violet-50 text-violet-700" };

/** Odkaz na předpis u zdroje (e-Sbírka, EUR-Lex). */
const sourceLink = (a: Pick<LegalActDto, "source" | "staleUrl">): { href: string; label: string } | null => {
  if (!a.staleUrl) return null;
  if (a.source === "esbirka") return { href: `https://e-sbirka.gov.cz${a.staleUrl}`, label: "e-Sbírka" };
  const eu = parseEuStaleUrl(a.staleUrl);
  return eu ? { href: eurlexUrl(eu.celex, eu.lang), label: "EUR-Lex" } : null;
};

/**
 * „/sb/2025/409/2025-11-01“ → „znění od 1. 11. 2025“; EUR-Lex: „02014R0910-20241018“ → „konsolidované znění k 18. 10. 2024“,
 * „32022L2555“ → „původní znění (Úř. věst.)“; ruční označení beze změny.
 */
const versionName = (t: Translate, label: string) => {
  const cons = label.match(/^0\d{4}[A-Z]{1,2}\d{4}-(\d{4})(\d{2})(\d{2})$/);
  if (cons) return t("leg.version.consolidated", { date: fmtDay(`${cons[1]}-${cons[2]}-${cons[3]}`) });
  if (/^3\d{4}[A-Z]{1,2}\d{4}/.test(label)) return t("leg.version.oj");
  const m = label.match(/^\/sb\/\d{4}\/\d+\/(\d{4}-\d{2}-\d{2})$/);
  if (!m) return label;
  return m[1] === "0000-00-00" ? t("leg.version.announced") : t("leg.version.of", { date: fmtDay(m[1]) });
};

function AddActModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const suggested = useQuery({ queryKey: ["legislation", "suggested"], queryFn: api.legislation.suggested, enabled: open });
  const [mode, setMode] = useState<"esbirka" | "eurlex" | "manual">("esbirka");
  const [ref, setRef] = useState("");
  const [lang, setLang] = useState<EuLang>(t.locale.startsWith("cs") ? "cs" : "en");
  const [owner, setOwner] = useState<string | null>(null);
  const [manual, setManual] = useState({ code: "", title: "", frameworkId: "" });
  const close = () => {
    setRef("");
    setManual({ code: "", title: "", frameworkId: "" });
    watch.reset();
    createManual.reset();
    onClose();
  };
  const watch = useMutation({
    mutationFn: (reference: string) => api.legislation.watch({ reference, ownerPositionId: owner, source: mode === "eurlex" ? "eurlex" : "esbirka", lang: mode === "eurlex" ? lang : undefined }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["legislation"] });
      if (!r.syncError) close();
    },
  });
  const createManual = useMutation({
    mutationFn: () => api.legislation.createManual({ code: manual.code, title: manual.title, frameworkId: manual.frameworkId || null, ownerPositionId: owner }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ["legislation"] }), close()),
  });
  return (
    <Modal
      open={open}
      onClose={close}
      title={t("leg.add.title")}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {t("common.close")}
          </Button>
          {mode !== "manual" ? (
            <Button disabled={!ref.trim() || watch.isPending} onClick={() => watch.mutate(ref)}>
              {watch.isPending ? t("leg.add.downloading") : t("leg.add.watch")}
            </Button>
          ) : (
            <Button disabled={!manual.code.trim() || !manual.title.trim() || createManual.isPending} onClick={() => createManual.mutate()}>
              {t("common.create")}
            </Button>
          )}
        </>
      }
    >
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 text-sm">
        {(
          [
            ["esbirka", t("leg.add.fromCollection")],
            ["eurlex", t("leg.add.fromEurlex")],
            ["manual", t("leg.add.manual")],
          ] as const
        ).map(([k, l]) => (
          <button key={k} onClick={() => (setMode(k), setRef(""), watch.reset())} className={cn("rounded-md px-3 py-1.5", mode === k ? "bg-white font-medium shadow-sm" : "text-slate-600")}>
            {l}
          </button>
        ))}
      </div>
      <ErrorBox error={watch.error ?? createManual.error} />
      {watch.data?.syncError && <ErrorBox error={new Error(t("leg.add.syncFailed", { error: watch.data.syncError }))} />}
      {mode !== "manual" ? (
        <>
          {mode === "eurlex" ? (
            <>
              <p className="text-xs text-slate-500">{t("leg.add.eurlexHint")}</p>
              <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
                <Field label={t("leg.add.celex")}>
                  <Input autoFocus placeholder="32022L2555" value={ref} onChange={(e) => setRef(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ref.trim() && watch.mutate(ref)} />
                </Field>
                <Field label={t("leg.add.textLang")}>
                  <Select value={lang} onChange={(e) => setLang(e.target.value as EuLang)}>
                    <option value="cs">{t("my.cestina")}</option>
                    <option value="en">{t("my.english")}</option>
                  </Select>
                </Field>
              </div>
            </>
          ) : (
            <Field label={t("leg.add.reference")}>
              <Input autoFocus placeholder={t("my.2642025Sb")} value={ref} onChange={(e) => setRef(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ref.trim() && watch.mutate(ref)} />
            </Field>
          )}
          <div>
            <div className="mb-1.5 text-xs text-slate-500">{t("leg.add.suggested")}</div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {(suggested.data ?? []).filter((s) => s.source === mode).map((s) => (
                <button
                  key={s.staleUrl}
                  disabled={s.watched || watch.isPending}
                  onClick={() => setRef(s.reference)}
                  className={cn("rounded-md border px-3 py-2 text-left text-xs", s.watched ? "border-emerald-200 bg-emerald-50 text-emerald-800" : ref === s.reference ? "border-brand-400 bg-brand-50" : "border-slate-200 hover:border-brand-300")}
                >
                  <div className="font-medium">
                    {s.watched && "✓ "}
                    {s.code}
                  </div>
                  <div className="line-clamp-1 text-slate-500">{s.title}</div>
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-slate-500">{t("leg.add.manualHint")}</p>
          <div className="grid gap-3 sm:grid-cols-[11rem_1fr]">
            <Field label={t("leg.add.code")}>
              <Input autoFocus value={manual.code} onChange={(e) => setManual({ ...manual, code: e.target.value })} placeholder={t("my.isoIec270012022")} />
            </Field>
            <Field label={t("leg.add.name")}>
              <Input value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} />
            </Field>
          </div>
          <Field label={t("leg.add.framework")} hint={t("leg.add.frameworkHint")}>
            <Select value={manual.frameworkId} onChange={(e) => setManual({ ...manual, frameworkId: e.target.value })}>
              <option value="">{t("common.noneOption")}</option>
              <FrameworkOptions label="short" />
            </Select>
          </Field>
        </>
      )}
      <Field label={t("leg.ownerPosition")} hint={t("leg.add.ownerHint")}>
        <PositionSelect value={owner} onChange={setOwner} />
      </Field>
    </Modal>
  );
}

function ReviewsTab() {
  const t = useT();
  const [status, setStatus] = useState("open");
  const q = useQuery({ queryKey: ["legislation", "reviews", status], queryFn: () => api.legislation.reviews(status || undefined) });
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-slate-100 p-4">
        <Select className="w-56" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("leg.col.state")}>
          <option value="open">{t("leg.filter.open")}</option>
          <option value="assessed">{t("leg.filter.assessed")}</option>
          <option value="closed">{t("leg.filter.closed")}</option>
          <option value="">{t("common.all")}</option>
        </Select>
      </div>
      <ErrorBox error={q.error} />
      {(q.data ?? []).length === 0 ? (
        <EmptyState>{q.isLoading ? t("common.loading") : t("leg.noChanges")}</EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2">{t("leg.col.actVersion")}</th>
              <th className="px-3 py-2">{t("leg.col.changes")}</th>
              <th className="px-3 py-2">{t("leg.col.owner")}</th>
              <th className="px-3 py-2">{t("leg.col.due")}</th>
              <th className="px-3 py-2">{t("leg.col.state")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {q.data!.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-5 py-2.5">
                  <Link to="/legislation/reviews/$reviewId" params={{ reviewId: r.id }} className="font-medium hover:text-brand-700">
                    {r.act.code}
                  </Link>
                  <div className="text-xs text-slate-500">
                    {r.change.from ? versionName(t, r.change.from) : t("leg.firstVersion")} → {versionName(t, r.change.to)} · {t("leg.detected", { date: fmtDay(r.change.detectedAt) })}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <ChangeCounts c={r.change} />
                </td>
                <td className="px-3 py-2.5 text-xs">{r.ownerPositionName ?? <span className="text-amber-700">{t("leg.unassigned")}</span>}</td>
                <td className={cn("px-3 py-2.5 text-xs", r.dueDate && r.dueDate < today() && (r.status === "new" || r.status === "in_review") && "font-medium text-red-700")}>
                  {r.dueDate ? fmtDay(r.dueDate) : "—"}
                  {r.dueDate && r.dueDate < today() && (r.status === "new" || r.status === "in_review") && <div className="text-[11px] font-normal">{t("leg.overdue")}</div>}
                </td>
                <td className="px-3 py-2.5">
                  <Badge tone={reviewTone[r.status]}>{LL(t, "reviewStatus", r.status)}</Badge> {r.impact && <Badge tone={impactTone[r.impact]}>{LL(t, "impact", r.impact)}</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function ChangeCounts({ c }: { c: { modified: number; added: number; removed: number } }) {
  const t = useT();
  return (
    <div className="flex gap-1.5 text-xs tabular-nums">
      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800" title={LL(t, "diffKind", "modified")}>~{c.modified}</span>
      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700" title={LL(t, "diffKind", "added")}>+{c.added}</span>
      <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700" title={LL(t, "diffKind", "removed")}>−{c.removed}</span>
    </div>
  );
}

function TasksTab() {
  const t = useT();
  const [all, setAll] = useState(false);
  const q = useQuery({ queryKey: ["legislation", "tasks", all], queryFn: () => api.legislation.tasks(all) });
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-slate-100 p-4 text-sm">
        <label className="flex items-center gap-1.5 text-slate-600">
          <input type="checkbox" className="accent-brand-600" checked={all} onChange={(e) => setAll(e.target.checked)} /> {t("leg.tasks.showAll")}
        </label>
      </div>
      <TaskList tasks={q.data ?? []} loading={q.isLoading} showAct />
    </Card>
  );
}

function TaskList({ tasks, loading, showAct, canEdit = true }: { tasks: LegalTaskDto[]; loading?: boolean; showAct?: boolean; canEdit?: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const upd = useMutation({ mutationFn: ({ id, status }: { id: string; status: LegalTaskDto["status"] }) => api.legislation.updateTask(id, { status }), onSuccess: () => qc.invalidateQueries({ queryKey: ["legislation"] }) });
  if (!tasks.length) return <EmptyState>{loading ? t("common.loading") : t("leg.tasks.none")}</EmptyState>;
  return (
    <>
      <ErrorBox error={upd.error} />
      <ul className="divide-y divide-slate-100">
        {tasks.map((task) => (
          <li key={task.id} className="flex flex-wrap items-start gap-3 px-5 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <div className={cn("font-medium", task.status !== "open" && "text-slate-400 line-through")}>{task.title}</div>
              {task.description && <div className="mt-0.5 whitespace-pre-wrap text-xs text-slate-600">{task.description}</div>}
              <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-slate-500">
                {showAct && task.act && task.reviewId && (
                  <Link to="/legislation/reviews/$reviewId" params={{ reviewId: task.reviewId }} className="hover:text-brand-700">
                    {task.act.code}
                  </Link>
                )}
                {task.policy && (
                  <Link to="/policies/$policyId" params={{ policyId: task.policy.id }} className="rounded border border-slate-200 px-1 hover:text-brand-700">
                    {task.policy.code} {task.policy.title}
                  </Link>
                )}
                {task.control && (
                  <Link to="/controls/$controlId" params={{ controlId: task.control.id }} className="rounded border border-slate-200 px-1 hover:text-brand-700">
                    {task.control.code} {task.control.name}
                  </Link>
                )}
                {task.requirementId && <span className="rounded border border-slate-200 px-1">{task.requirementId}</span>}
                <span>{task.ownerPositionName ?? t("leg.tasks.noOwner")}</span>
                {task.dueDate && <span>{t("leg.tasks.due", { date: fmtDay(task.dueDate) })}</span>}
              </div>
            </div>
            <Badge tone={task.status === "open" ? "amber" : task.status === "done" ? "green" : "slate"}>{LL(t, "taskStatus", task.status)}</Badge>
            {canEdit &&
              (task.status === "open" ? (
                <div className="flex gap-1">
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => upd.mutate({ id: task.id, status: "done" })}>
                    <CheckCircle2 size={13} /> {t("leg.tasks.done")}
                  </Button>
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => upd.mutate({ id: task.id, status: "cancelled" })}>
                    {t("common.cancelAction")}
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => upd.mutate({ id: task.id, status: "open" })}>
                  {t("common.reopen")}
                </Button>
              ))}
          </li>
        ))}
      </ul>
    </>
  );
}

/* ---------- předpis ---------- */

export function LegalActPage() {
  const t = useT();
  const { actId } = useParams({ strict: false }) as { actId: string };
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["legislation", "act", actId], queryFn: () => api.legislation.act(actId) });
  const [versionId, setVersionId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const vid = versionId ?? q.data?.currentVersion?.id ?? null;
  const frags = useQuery({ queryKey: ["legislation", "fragments", vid], queryFn: () => api.legislation.fragments(vid!), enabled: !!vid });
  const sync = useMutation({ mutationFn: () => api.legislation.sync(actId), onSuccess: () => qc.invalidateQueries({ queryKey: ["legislation"] }) });
  const [ver, setVer] = useState({ label: "", effectiveFrom: "", text: "" });
  const [file, setFile] = useState<File | null>(null);
  const addVer = useMutation({
    mutationFn: () => (file ? api.legislation.addVersionFile(actId, file, ver.label, ver.effectiveFrom || null) : api.legislation.addVersion(actId, { label: ver.label, effectiveFrom: ver.effectiveFrom || null, text: ver.text })),
    onSuccess: () => {
      setVer({ label: "", effectiveFrom: "", text: "" });
      setFile(null);
      qc.invalidateQueries({ queryKey: ["legislation"] });
    },
  });
  const [owner, setOwner] = useState<string | null | undefined>(undefined);
  const saveOwner = useMutation({ mutationFn: (v: string | null) => api.legislation.updateWatch(actId, { ownerPositionId: v }), onSuccess: () => qc.invalidateQueries({ queryKey: ["legislation"] }) });
  const shown = useMemo(() => {
    const sq = search.trim().toLowerCase();
    return (frags.data ?? []).filter((f) => !sq || `${f.label} ${f.text}`.toLowerCase().includes(sq));
  }, [frags.data, search]);
  // osnova: paragrafy / články / kapitoly nejvyšší úrovně
  const outline = useMemo(
    () => (frags.data ?? []).map((f, i) => ({ f, i })).filter(({ f }) => /^(par_\w+|cl_\w+|k_[A-Z]?\.?\d+(\.\d+)?|prefix|priloha_\d+)$/i.test(f.key) && !/~\d+$/.test(f.key)),
    [frags.data],
  );
  const a = q.data;
  if (!a) return <ErrorBox error={q.error} />;
  const write = can("legislation:write");
  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/legislation" className="hover:text-brand-700">
          {t("nav.legislation")}
        </Link>
      </div>
      <PageHeader
        title={`${a.code} – ${a.title}`}
        subtitle={`${LL(t, "source", a.source)}${a.currentVersion ? ` · ${t("leg.act.watched", { version: versionName(t, a.currentVersion.label) })}${a.currentVersion.effectiveFrom ? ` (${t("leg.effectiveFrom", { date: fmtDay(a.currentVersion.effectiveFrom) })})` : ""}` : ""}${a.currentVersion?.textSource ? ` · ${t("leg.textSource", { source: t(`leg.textSource.${a.currentVersion.textSource}` as never) })}` : ""}`}
        actions={
          <>
            {sourceLink(a) && (
              <a href={sourceLink(a)!.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
                {sourceLink(a)!.label} <ExternalLink size={13} />
              </a>
            )}
            {write && a.source !== "manual" && (
              <Button disabled={sync.isPending} onClick={() => sync.mutate()}>
                <RefreshCw size={15} className={sync.isPending ? "animate-spin" : ""} /> {t("leg.act.checkNow")}
              </Button>
            )}
          </>
        }
      />
      <ErrorBox error={sync.error ?? addVer.error ?? saveOwner.error} />
      {sync.data && <SuccessBox>{sync.data.changeId ? t("leg.act.newFound") : t("leg.act.noChange")}</SuccessBox>}
      {a.lastStatus === "error" && <ErrorBox error={new Error(t("leg.act.lastFailed", { error: a.lastError }))} />}
      {a.lastStatus === "ok" && a.lastError && <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{a.lastError}</div>}
      {a.repeal && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {t("leg.act.repeal", { date: a.repeal.date ? fmtDay(a.repeal.date) : "", title: a.repeal.title })}
        </div>
      )}
      {a.currentVersion?.effectiveFrom && a.currentVersion.effectiveFrom > today() && (
        <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          {t("leg.act.future", { date: fmtDay(a.currentVersion.effectiveFrom) })}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card className="overflow-hidden">
          <CardHeader title={t("leg.act.text")} subtitle={t("leg.act.textSub")} />
          <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
            <Select className="w-72" value={vid ?? ""} onChange={(e) => setVersionId(e.target.value || null)} aria-label={t("leg.act.versionSelect")}>
              {a.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {versionName(t, v.label)} {v.effectiveFrom && !v.label.startsWith("/sb/") ? `(${t("leg.from", { date: fmtDay(v.effectiveFrom) })})` : ""}
                </option>
              ))}
            </Select>
            <Input className="max-w-xs" placeholder={t("leg.act.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {!vid ? (
            <EmptyState>{a.source === "manual" ? t("leg.act.noVersionManual") : t("leg.act.noVersion")}</EmptyState>
          ) : (
            <div className="flex">
              {outline.length > 2 && !search && (
                <nav className="hidden max-h-[44rem] w-44 shrink-0 overflow-y-auto border-r border-slate-100 py-2 text-xs md:block" aria-label={t("leg.act.outline")}>
                  {outline.map(({ f, i }) => (
                    <button
                      key={`${f.key}-${i}`}
                      onClick={() => document.getElementById(`frag-${i}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                      className="block w-full truncate px-4 py-1 text-left text-slate-600 hover:bg-slate-50 hover:text-brand-700"
                      title={f.label}
                    >
                      {f.label || f.key}
                    </button>
                  ))}
                </nav>
              )}
              <div className="max-h-[44rem] flex-1 overflow-y-auto">
                {shown.slice(0, 800).map((f) => {
                  const i = frags.data!.indexOf(f);
                  const head = f.depth <= 1 && /^(par_|cl_|k_|prefix|priloha)/.test(f.key) && !f.key.includes("-");
                  return (
                    <div key={`${f.key}-${i}`} id={`frag-${i}`} className={cn("scroll-mt-2 px-5 py-1.5 text-sm", head && "mt-2 border-t border-slate-100 pt-3")} style={{ paddingLeft: `${1.25 + Math.min(f.depth, 6) * 0.75}rem` }}>
                      <span className={cn("mr-2 text-xs", head ? "font-semibold text-slate-700" : "text-slate-400")}>{f.label}</span>
                      <span className={cn("whitespace-pre-wrap", head ? "font-medium text-slate-900" : "text-slate-800")}>{f.label.endsWith(f.text) ? "" : f.text}</span>
                    </div>
                  );
                })}
                {shown.length > 800 && <div className="p-4 text-xs text-slate-500">{t("leg.act.truncated", { n: shown.length })}</div>}
                {!shown.length && <EmptyState>{t("common.nothingFound")}</EmptyState>}
              </div>
            </div>
          )}
        </Card>
        <div className="space-y-6">
          {a.watch && (
            <Card>
              <CardHeader title={t("leg.act.watching")} />
              <div className="space-y-2 p-5 text-sm">
                <Field label={t("leg.ownerPosition")}>
                  <PositionSelect value={owner === undefined ? a.watch.ownerPositionId : owner} onChange={(v) => (setOwner(v), saveOwner.mutate(v))} disabled={!write} />
                </Field>
                <div className="text-xs text-slate-500">{t("leg.act.lastCheck", { time: fmtTime(a.lastCheckedAt) })}</div>
              </div>
            </Card>
          )}
          <Card>
            <CardHeader title={t("leg.col.changes")} />
            {a.changes.length === 0 ? (
              <EmptyState>{t("leg.act.noChanges")}</EmptyState>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {a.changes.map((ch) => (
                  <li key={ch.id} className="px-5 py-2">
                    {ch.reviewId ? (
                      <Link to="/legislation/reviews/$reviewId" params={{ reviewId: ch.reviewId }} className="font-medium hover:text-brand-700">
                        {versionName(t, ch.to)}
                      </Link>
                    ) : (
                      <span className="font-medium">{versionName(t, ch.to)}</span>
                    )}
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                      {fmtDay(ch.detectedAt)} <ChangeCounts c={ch} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {a.source === "manual" && write && (
            <Card>
              <CardHeader title={t("leg.act.newVersion")} subtitle={t("leg.act.newVersionSub")} />
              <div className="space-y-3 p-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("leg.act.versionLabel")}>
                    <Input value={ver.label} onChange={(e) => setVer({ ...ver, label: e.target.value })} placeholder={t("my.2022Amd12024")} />
                  </Field>
                  <Field label={t("leg.act.effective")}>
                    <Input type="date" value={ver.effectiveFrom} onChange={(e) => setVer({ ...ver, effectiveFrom: e.target.value })} />
                  </Field>
                </div>
                <Field label={t("leg.act.file")}>
                  <Input type="file" accept=".docx,.odt,.txt,.md" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </Field>
                {!file && (
                  <Field label={t("leg.act.orPaste")}>
                    <Textarea rows={6} value={ver.text} onChange={(e) => setVer({ ...ver, text: e.target.value })} />
                  </Field>
                )}
                <Button disabled={!ver.label.trim() || (!file && !ver.text.trim()) || addVer.isPending} onClick={() => addVer.mutate()}>
                  {t("leg.act.saveVersion")}
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

/* ---------- posouzení změny ---------- */

export function LegalReviewPage() {
  const { reviewId } = useParams({ strict: false }) as { reviewId: string };
  const q = useQuery({ queryKey: ["legislation", "review", reviewId], queryFn: () => api.legislation.review(reviewId) });
  if (!q.data) return <ErrorBox error={q.error} />;
  return <ReviewEditor key={q.data.id + q.data.status + (q.data.assessedAt ?? "")} r={q.data} />;
}

function ReviewEditor({ r }: { r: LegalReviewDetail }) {
  const t = useT();
  const qc = useQueryClient();
  const [f, setF] = useState({ impact: r.impact ?? ("" as LegalImpact | ""), assessment: r.assessment ?? "", ownerPositionId: r.ownerPositionId, dueDate: r.dueDate ?? "" });
  const [kind, setKind] = useState<"" | LegalDiffItem["kind"]>("");
  const [side, setSide] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["legislation"] });
  const save = useMutation({
    mutationFn: (status?: LegalReviewStatus) =>
      api.legislation.updateReview(r.id, { impact: f.impact || null, assessment: f.assessment || null, ownerPositionId: f.ownerPositionId, dueDate: f.dueDate || null, ...(status ? { status } : {}) }),
    onSuccess: refresh,
  });
  const [task, setTask] = useState({ title: "", description: "", ownerPositionId: r.ownerPositionId as string | null, dueDate: r.dueDate ?? "", policyId: "", requirementId: "" });
  const addTask = useMutation({
    mutationFn: () =>
      api.legislation.addTask(r.id, {
        title: task.title,
        description: task.description || null,
        ownerPositionId: task.ownerPositionId,
        dueDate: task.dueDate || null,
        policyId: task.policyId || null,
        requirementId: task.requirementId || null,
      }),
    onSuccess: () => (setTask({ ...task, title: "", description: "", policyId: "", requirementId: "" }), refresh()),
  });
  const diff = r.diff.filter((d) => !kind || d.kind === kind);
  const edit = r.canEdit && r.status !== "closed";
  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/legislation" className="hover:text-brand-700">
          {t("nav.legislation")}
        </Link>{" "}
        ›{" "}
        <Link to="/legislation/acts/$actId" params={{ actId: r.act.id }} className="hover:text-brand-700">
          {r.act.code}
        </Link>
      </div>
      <PageHeader
        title={t("leg.review.title", { code: r.act.code, version: versionName(t, r.change.to) })}
        subtitle={`${r.act.title} · ${t("leg.review.previous", { version: r.change.from ? versionName(t, r.change.from) : "—" })} · ${t("leg.detected", { date: fmtDay(r.change.detectedAt) })}${r.change.effectiveFrom ? ` · ${t("leg.effectiveFrom", { date: fmtDay(r.change.effectiveFrom) })}` : ""}`}
      />
      <Stepper status={r.status} dueDate={r.dueDate} />
      <ErrorBox error={save.error ?? addTask.error} />
      <div className="grid gap-6 xl:grid-cols-[1fr_26rem]">
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader title={t("leg.review.diff")} subtitle={`${t("leg.review.counts", { m: r.change.modified, a: r.change.added, r: r.change.removed })}${r.diffTotal > r.diff.length ? ` · ${t("leg.review.shown", { n: r.diff.length, total: r.diffTotal })}` : ""}`} />
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
              {(["", "modified", "added", "removed"] as const).map((k) => (
                <button key={k} onClick={() => setKind(k)} className={cn("rounded px-2 py-1 text-xs", kind === k ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-50")}>
                  {k ? LL(t, "diffKind", k) : t("common.all")} <span className="text-slate-400">{k ? r.diff.filter((d) => d.kind === k).length : r.diff.length}</span>
                </button>
              ))}
              <div className="ml-auto flex rounded-md bg-slate-100 p-0.5 text-xs">
                <button onClick={() => setSide(false)} className={cn("rounded px-2 py-1", !side && "bg-white shadow-sm")}>
                  {t("leg.review.inline")}
                </button>
                <button onClick={() => setSide(true)} className={cn("rounded px-2 py-1", side && "bg-white shadow-sm")}>
                  {t("leg.review.side")}
                </button>
              </div>
            </div>
            <div className="max-h-[48rem] divide-y divide-slate-100 overflow-y-auto">
              {diff.map((d) => (
                <div key={`${d.kind}-${d.key}`} className={cn("border-l-4 px-5 py-3 text-sm", d.kind === "added" ? "border-emerald-400" : d.kind === "removed" ? "border-red-400" : "border-amber-400")}>
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-800">{d.label}</span>
                    <Badge tone={d.kind === "added" ? "green" : d.kind === "removed" ? "red" : "amber"}>{LL(t, "diffKind", d.kind)}</Badge>
                    {d.requirementIds?.map((id) => (
                      <Badge key={id} tone="violet">
                        {id}
                      </Badge>
                    ))}
                  </div>
                  {side && d.kind === "modified" ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="whitespace-pre-wrap rounded bg-red-50/60 p-2 text-slate-700">
                        <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">{t("leg.review.before")}</div>
                        {d.parts?.filter((p) => p.t !== "+").map((p, i) => (
                          <span key={i} className={p.t === "-" ? "bg-red-200/70" : ""}>
                            {p.v}
                          </span>
                        )) ?? d.before}
                      </div>
                      <div className="whitespace-pre-wrap rounded bg-emerald-50/60 p-2 text-slate-800">
                        <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">{t("leg.review.after")}</div>
                        {d.parts?.filter((p) => p.t !== "-").map((p, i) => (
                          <span key={i} className={p.t === "+" ? "bg-emerald-200/70" : ""}>
                            {p.v}
                          </span>
                        )) ?? d.after}
                      </div>
                    </div>
                  ) : d.kind === "modified" && d.parts ? (
                    <div className="whitespace-pre-wrap leading-relaxed">
                      {d.parts.map((p, i) => (
                        <span key={i} className={p.t === "+" ? "bg-emerald-100 text-emerald-900" : p.t === "-" ? "bg-red-100 text-red-900 line-through" : ""}>
                          {p.v}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className={cn("whitespace-pre-wrap rounded p-2", d.kind === "added" ? "bg-emerald-50 text-slate-800" : "bg-red-50 text-slate-500 line-through")}>{d.after ?? d.before}</div>
                  )}
                </div>
              ))}
              {!diff.length && <EmptyState>{t("common.nothingToShow")}</EmptyState>}
            </div>
          </Card>

          <div className="empty:hidden">
            <AiSuggestPanel useCase="legal_change" entityId={r.id} canApply={r.canEdit} onApplied={refresh} />
          </div>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title={t("leg.review.assessment")} subtitle={t("leg.review.assessmentSub")} />
            <fieldset disabled={!edit} className="space-y-3 p-5">
              {r.aiSummary && (
                <div className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-900">
                  <div className="mb-0.5 font-medium">{t("leg.review.aiSummary")}</div>
                  <div className="whitespace-pre-wrap">{r.aiSummary}</div>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("leg.review.impact")}>
                  <Select value={f.impact} onChange={(e) => setF({ ...f, impact: e.target.value as LegalImpact | "" })}>
                    <option value="">{t("common.unsetOption")}</option>
                    {LEGAL_IMPACTS.map((i) => (
                      <option key={i} value={i}>
                        {LL(t, "impact", i)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("leg.review.due")}>
                  <Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
                </Field>
              </div>
              <Field label={t("leg.ownerPosition")}>
                <PositionSelect value={f.ownerPositionId} onChange={(v) => setF({ ...f, ownerPositionId: v })} />
              </Field>
              <Field label={t("leg.review.text")}>
                <Textarea rows={6} value={f.assessment} onChange={(e) => setF({ ...f, assessment: e.target.value })} placeholder={t("leg.review.textHint")} />
              </Field>
              {r.assessedAt && (
                <div className="text-xs text-slate-500">
                  {t("leg.review.assessedBy", { name: r.assessedByName ?? "—", time: fmtTime(r.assessedAt) })}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" disabled={save.isPending} onClick={() => save.mutate(r.status === "new" ? "in_review" : undefined)}>
                  {t("leg.review.saveDraft")}
                </Button>
                <Button disabled={save.isPending || !f.impact || !f.assessment.trim()} onClick={() => save.mutate("assessed")}>
                  {t("leg.review.confirm")}
                </Button>
                {r.status === "assessed" && (
                  <Button variant="secondary" disabled={save.isPending} onClick={() => save.mutate("closed")}>
                    {t("leg.review.close")}
                  </Button>
                )}
              </div>
            </fieldset>
            {r.status === "closed" && r.canEdit && (
              <div className="border-t border-slate-100 px-5 py-3">
                <Button variant="ghost" onClick={() => save.mutate("in_review")}>
                  {t("common.reopen")}
                </Button>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title={t("leg.review.affected")} subtitle={t("leg.review.affectedSub")} />
            <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100 text-center">
              {(
                [
                  [t("leg.review.requirements"), r.affected.requirements.length],
                  [t("leg.review.controls"), r.affected.controls.length],
                  [t("leg.review.documents"), r.affected.policies.length],
                ] as const
              ).map(([l, n]) => (
                <div key={l} className="py-3">
                  <div className={cn("text-xl font-semibold", n ? "text-slate-900" : "text-slate-300")}>{n}</div>
                  <div className="text-xs text-slate-500">{l}</div>
                </div>
              ))}
            </div>
            {r.affected.requirements.length + r.affected.controls.length + r.affected.policies.length === 0 ? (
              <p className="px-5 py-4 text-xs text-slate-500">
                {t("leg.review.noAffected")}
              </p>
            ) : (
              <div className="space-y-4 p-5 text-sm">
                {r.affected.requirements.length > 0 && (
                  <ul className="space-y-1.5 text-xs">
                    {r.affected.requirements.map((q) => (
                      <li key={q.id} className="flex gap-2">
                        <Badge tone="violet">{q.ref}</Badge>
                        <span className="line-clamp-2 text-slate-600">{q.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {r.affected.controls.length > 0 && (
                  <div>
                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("leg.review.controls")}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {r.affected.controls.map((c) => (
                        <Link key={c.id} to="/controls/$controlId" params={{ controlId: c.id }} className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:border-brand-300 hover:text-brand-700">
                          <span className="font-medium">{c.code}</span> {c.name}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
                {r.affected.policies.length > 0 && (
                  <div>
                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("leg.review.documents")}</div>
                    <ul className="space-y-1 text-xs">
                      {r.affected.policies.map((p) => (
                        <li key={p.id} className="flex items-baseline justify-between gap-2">
                          <Link to="/policies/$policyId" params={{ policyId: p.id }} className="hover:text-brand-700">
                            <span className="font-medium">{p.code}</span> {p.title}
                          </Link>
                          <span className="shrink-0 text-slate-400">{p.via}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card className="overflow-hidden">
            <CardHeader title={t("leg.review.tasks", { n: r.tasks.length })} />
            <TaskList tasks={r.tasks} canEdit={r.canEdit} />
            {edit && (
              <div className="space-y-2 border-t border-slate-100 p-5">
                <Input placeholder={t("leg.review.newTask")} value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} />
                <Textarea rows={2} placeholder={t("leg.review.taskDesc")} value={task.description} onChange={(e) => setTask({ ...task, description: e.target.value })} />
                <div className="grid gap-2 sm:grid-cols-2">
                  <PositionSelect value={task.ownerPositionId} onChange={(v) => setTask({ ...task, ownerPositionId: v })} />
                  <Input type="date" value={task.dueDate} onChange={(e) => setTask({ ...task, dueDate: e.target.value })} />
                </div>
                <Select value={task.policyId} onChange={(e) => setTask({ ...task, policyId: e.target.value })} aria-label={t("leg.review.document")}>
                  <option value="">{t("leg.review.noDocument")}</option>
                  {r.affected.policies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} {p.title}
                    </option>
                  ))}
                </Select>
                <Button disabled={!task.title.trim() || addTask.isPending} onClick={() => addTask.mutate()}>
                  {t("leg.review.addTask")}
                </Button>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

const STEPS: { key: LegalReviewStatus; label: MsgKey }[] = [
  { key: "new", label: "leg.step.new" },
  { key: "in_review", label: "leg.step.in_review" },
  { key: "assessed", label: "leg.step.assessed" },
  { key: "closed", label: "leg.step.closed" },
];
function Stepper({ status, dueDate }: { status: LegalReviewStatus; dueDate: string | null }) {
  const t = useT();
  const cur = STEPS.findIndex((x) => x.key === status);
  const late = dueDate && dueDate < today() && cur < 2;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
      {STEPS.map((st, i) => (
        <div key={st.key} className="flex items-center gap-2">
          {i > 0 && <div className={cn("h-px w-6 sm:w-10", i <= cur ? "bg-brand-400" : "bg-slate-200")} />}
          <span
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
              i < cur ? "bg-brand-600 text-white" : i === cur ? "bg-brand-100 text-brand-700 ring-2 ring-brand-500" : "bg-slate-100 text-slate-400",
            )}
          >
            {i < cur ? "✓" : i + 1}
          </span>
          <span className={cn(i === cur ? "font-medium text-slate-900" : i < cur ? "text-slate-600" : "text-slate-400")}>{t(st.label)}</span>
        </div>
      ))}
      {dueDate && cur < 2 && (
        <span className={cn("ml-auto text-xs", late ? "font-medium text-red-700" : "text-slate-500")}>
          {late ? t("leg.step.lateDue") : t("leg.step.due")}
          {fmtDay(dueDate)}
        </span>
      )}
    </div>
  );
}

/** Volba zdroje textu Sbírky (v1.13.2) – jen správce systému. */
function TextSourceSelect({ value, apiConfigured }: { value: "auto" | "opendata" | "web" | "api"; apiConfigured: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (v: typeof value) => api.admin.updateSettings({ legalTextSource: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["legislation"] }),
  });
  return (
    <label className="inline-flex items-center gap-1.5">
      {t("leg.mode.label")}
      <select className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs" value={value} disabled={save.isPending} onChange={(e) => save.mutate(e.target.value as typeof value)}>
        <option value="auto">{t("leg.mode.auto")}</option>
        <option value="opendata">{t("leg.mode.opendata")}</option>
        <option value="web">{t("leg.mode.web")}</option>
        <option value="api" disabled={!apiConfigured}>
          {t("leg.mode.api")}
        </option>
      </select>
    </label>
  );
}
