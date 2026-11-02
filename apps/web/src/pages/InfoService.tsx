import { askConfirm } from "@/components/ui/overlay";
import { RelatedRecordsCard } from "@/components/records";
/** Informační servis regulátora (ADR-087): RSS NÚKIB, otevřená data o incidentech, stav Národního MISP. */
import { Legend, StackedBars, type Segment } from "@/components/charts";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, SuccessBox, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useModule } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn, fmtDate, fmtDay, useDebounced } from "@/lib/utils";
import { INFO_ASSESSMENT_LABELS, INFO_ASSESSMENT_STATUSES, type InfoAssessmentDto, type InfoAssessmentStatus, FEED_ITEM_KINDS, FEED_ITEM_LABELS, NUKIB_CLASSES, NUKIB_OPENDATA_REPO, NUKIB_SEVERITIES, type FeedItemKind, type InfoFeedItemDto, type InfoServiceDto, type InfoServiceSettingsInput } from "@contix/shared";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { AssetPicker, PositionSelect, type PickedAsset } from "@/components/pickers";
import { AlertTriangle, Bug, ExternalLink, Newspaper, Plus, RefreshCw, Settings, Share2, Sparkles, Upload } from "lucide-react";
import { useState } from "react";

const KIND_TONE: Record<FeedItemKind, Tone> = { warning: "red", vulnerability: "amber", report: "blue", guidance: "violet", news: "slate" };
/** Kategoriální paleta (rozlišitelná i pro poruchy barvocitu); poslední = ostatní. */
const PALETTE = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#D55E00", "#94a3b8"];

export function InfoServicePage() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const [kind, setKind] = useState<FeedItemKind | "">("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [unreviewed, setUnreviewed] = useState(false);
  const [publisher, setPublisher] = useState("");
  const [allCountries, setAllCountries] = useState(false);
  const [settings, setSettings] = useState(false);
  const [reviewing, setReviewing] = useState<InfoFeedItemDto | null>(null);
  const info = useQuery({ queryKey: ["infoservice"], queryFn: api.infoService.get });
  const items = useQuery({
    queryKey: ["infoservice", "items", kind, dq, unreviewed, publisher, allCountries],
    queryFn: () => api.infoService.items({ kind: kind || undefined, q: dq || undefined, unreviewed: unreviewed ? "1" : undefined, publisher: publisher || undefined, scope: allCountries ? "all" : undefined }),
    placeholderData: keepPreviousData,
  });
  const refresh = useMutation({
    mutationFn: api.infoService.refresh,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["infoservice"] }),
  });
  const unreview = useMutation({ mutationFn: (id: string) => api.infoService.unreview(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["infoservice"] }) });
  const d = info.data;
  const publishers = [...new Set((d?.settings.feeds ?? []).map((f) => f.publisher || f.name))];
  const countries = new Set((d?.settings.feeds ?? []).map((f) => f.country ?? ""));
  const errors = d ? Object.entries(d.state).filter(([, s]) => s.error) : [];

  return (
    <>
      <PageHeader
        title={t("ifs.title")}
        subtitle={t("ifs.subtitle")}
        actions={
          <>
            {can("admin:settings") && (
              <Button variant="secondary" onClick={() => setSettings(true)}>
                <Settings size={15} /> {t("ifs.settings")}
              </Button>
            )}
            {can("legislation:write") && (
              <Button onClick={() => refresh.mutate()} disabled={refresh.isPending}>
                <RefreshCw size={15} className={refresh.isPending ? "animate-spin" : ""} /> {t("ifs.refresh")}
              </Button>
            )}
          </>
        }
      />
      <ErrorBox error={info.error ?? refresh.error} />
      {errors.length > 0 && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {errors.map(([k, s]) => (
            <div key={k}>
              {t("ifs.sourceError", { source: d!.settings.feeds.find((f) => f.id === k)?.name ?? (k === "nukib-opendata" ? t("ifs.opendata") : k), error: s.error ?? "" })}
            </div>
          ))}
          <div className="mt-1 text-xs">{t("ifs.offlineHint")}</div>
        </div>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={<AlertTriangle size={16} />} label={t("ifs.kpi.warnings")} value={d?.counts.warningsOpen ?? "–"} note={t("ifs.kpi.warningsNote")} tone={d?.counts.warningsOpen ? "red" : "slate"} onClick={() => { setKind("warning"); setUnreviewed(true); }} />
        <Kpi icon={<Bug size={16} />} label={t("ifs.kpi.vulns")} value={d?.counts.vulnerabilities30d ?? "–"} note={t("ifs.kpi.vulnsNote")} tone={d?.counts.vulnerabilities30d ? "amber" : "slate"} onClick={() => { setKind("vulnerability"); setUnreviewed(false); }} />
        <Kpi icon={<Newspaper size={16} />} label={t("ifs.kpi.unreviewed")} value={d?.counts.unreviewed ?? "–"} note={t("ifs.kpi.total", { n: d?.counts.total ?? 0 })} tone="slate" onClick={() => { setKind(""); setUnreviewed(true); }} />
        <Kpi icon={<RefreshCw size={16} />} label={t("ifs.kpi.updated")} value={d?.lastRefreshAt ? fmtDate(d.lastRefreshAt) : "–"} note={d?.settings.autoRefresh ? t("ifs.kpi.auto", { h: d.settings.intervalHours }) : t("ifs.kpi.manual")} tone="slate" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={t("ifs.news")} subtitle={t("ifs.newsSubtitle")} />
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
            <div className="flex flex-wrap gap-1">
              {(["", ...FEED_ITEM_KINDS] as const).map((k) => (
                <button
                  key={k || "all"}
                  onClick={() => setKind(k)}
                  className={cn("rounded-full border px-2.5 py-0.5 text-xs", kind === k ? "border-brand-600 bg-brand-50 font-medium text-brand-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")}
                >
                  {k ? t.lbl(FEED_ITEM_LABELS[k]) : t("ifs.allKinds")}
                </button>
              ))}
            </div>
            {publishers.length > 1 && (
              <Select className="w-40 py-1 text-xs" value={publisher} onChange={(e) => setPublisher(e.target.value)} aria-label={t("ifs.publisher")}>
                <option value="">{t("ifs.allPublishers")}</option>
                {publishers.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            )}
            {countries.size > 1 && <Checkbox checked={allCountries} onChange={setAllCountries} label={t("ifs.allCountries")} />}
            <Input className="ml-auto w-48 py-1 text-sm" placeholder={t("ifs.search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("ifs.search")} />
            <Checkbox checked={unreviewed} onChange={setUnreviewed} label={t("ifs.onlyUnreviewed")} />
          </div>
          <ErrorBox error={items.error ?? unreview.error} />
          {items.data && !items.data.length ? (
            <EmptyState>
              {d?.counts.total ? t("ifs.noMatch") : t("ifs.empty")}
              {!d?.counts.total && <div className="mt-1 text-xs">{t("ifs.emptyHint")}</div>}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100" data-testid="info-items">
              {(items.data ?? []).map((i) => (
                <li key={i.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <Badge tone={KIND_TONE[i.kind]}>{t.lbl(FEED_ITEM_LABELS[i.kind])}</Badge>
                    <span>{i.publishedAt ? fmtDay(i.publishedAt) : "—"}</span>
                    <span>
                      · {i.publisher || i.feedName}
                      {i.country ? ` (${i.country})` : ""}
                    </span>
                    {i.assessment && (
                      <span className="inline-flex items-center gap-1" title={i.assessment.note || undefined}>
                        <Badge tone={STATUS_TONE[i.assessment.status]}>{t.lbl(INFO_ASSESSMENT_LABELS[i.assessment.status])}</Badge>
                        <span>{t("ifs.reviewed", { date: fmtDay(i.assessment.at), name: i.assessment.userName ?? "—" })}</span>
                        {i.assessment.ownerName && <span>· {i.assessment.ownerName}</span>}
                        {i.assessment.dueDate && <span>· {t("ifs.due", { date: fmtDay(i.assessment.dueDate) })}</span>}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 font-medium text-slate-900">
                    {i.link ? (
                      <a href={i.link} target="_blank" rel="noopener noreferrer" className="hover:text-brand-700 hover:underline">
                        {i.title} <ExternalLink size={12} className="inline align-baseline text-slate-400" />
                      </a>
                    ) : (
                      i.title
                    )}
                  </div>
                  {i.summary && <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">{i.summary}</p>}
                  {i.review?.note && <p className="mt-1 rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">{i.review.note}</p>}
                  {i.assessment && (i.assessment.assets.length > 0 || i.assessment.links.length > 0) && (
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600">
                      {i.assessment.assets.length > 0 && (
                        <span>
                          {t("ifs.assets")}:{" "}
                          {i.assessment.assets.map((a, n) => (
                            <span key={a.id}>
                              {n > 0 && ", "}
                              <Link to="/assets/$assetId" params={{ assetId: a.id }} className="text-brand-700 hover:underline">
                                {a.name}
                              </Link>
                            </span>
                          ))}
                        </span>
                      )}
                      {i.assessment.links.map((l) => (
                        <LinkedRecord key={l.kind + l.targetId} l={l} />
                      ))}
                    </div>
                  )}
                  {can("legislation:write") && (
                    <div className="mt-1.5 flex gap-2">
                      <Button variant="secondary" className="px-2 py-0.5 text-xs" onClick={() => setReviewing(i)}>
                        {i.assessment ? t("ifs.editReview") : t("ifs.review")}
                      </Button>
                      {i.review && (
                        <Button variant="secondary" className="px-2 py-0.5 text-xs" onClick={() => unreview.mutate(i.id)}>
                          {t("ifs.unreview")}
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          {d && <StatsCard d={d} />}
          {d && <MispCard d={d} />}
        </div>
      </div>
      {reviewing && <ReviewModal item={reviewing} onClose={() => setReviewing(null)} />}
      {settings && d && <SettingsModal d={d} onClose={() => setSettings(false)} />}
    </>
  );
}

const kpiTone = { red: "text-red-700", amber: "text-amber-700", slate: "text-slate-500" } as const;
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

function StatsCard({ d }: { d: InfoServiceDto }) {
  const t = useT();
  const can = useCan();
  const [editing, setEditing] = useState<string | null>(null);
  const s = d.stats;
  const nextMonth = () => {
    // výchozí měsíc: poslední přehled z RSS bez ručních údajů, jinak minulý měsíc
    const r = d.reports.find((x) => x.month && !d.manualMonths.includes(x.month));
    if (r?.month) return r.month;
    const n = new Date();
    n.setMonth(n.getMonth() - 1);
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
  };
  const [bulk, setBulk] = useState(false);
  const action = can("legislation:write") && (
    <div className="flex gap-2">
      {d.suggestAvailable && (
        <Button variant="secondary" className="text-xs" onClick={() => setBulk(true)}>
          <Upload size={14} /> {t("ifs.bulk")}
        </Button>
      )}
      <Button variant="secondary" className="text-xs" onClick={() => setEditing(nextMonth())}>
        <Plus size={14} /> {t("ifs.addMonth")}
      </Button>
    </div>
  );
  const modal = (
    <>
      {editing && <MonthModal d={d} initialMonth={editing} onClose={() => setEditing(null)} />}
      {bulk && <BulkModal d={d} onClose={() => setBulk(false)} />}
    </>
  );
  if (!s.lastMonth)
    return (
      <Card>
        <CardHeader title={t("ifs.stats")} subtitle={t("ifs.statsSubtitle")} action={action} />
        <p className="px-5 py-4 text-sm text-slate-500">{t("ifs.statsEmpty")}</p>
        {modal}
      </Card>
    );
  const top = s.classes.slice(0, PALETTE.length - 1);
  const rest = s.classes.slice(PALETTE.length - 1).map((c) => c.name);
  const segments: Segment[] = [
    ...top.map((c, i) => ({ key: c.name, label: c.name, color: PALETTE[i]! })),
    { key: "__other", label: t("ifs.otherClasses"), color: PALETTE.at(-1)! },
  ];
  const rows = s.months.map((m) => {
    const shown = top.reduce((n, c) => n + (m.byClass[c.name] ?? 0), 0);
    // měsíc zadaný jen podle závažnosti: počet bez klasifikace jde do „další kategorie“
    return { month: m.month, ...Object.fromEntries(top.map((c) => [c.name, m.byClass[c.name] ?? 0])), __other: Math.max(0, m.total - shown) };
  });
  const usedSegments = segments.filter((g) => rows.some((r) => Number((r as Record<string, unknown>)[g.key]) > 0));
  // stáří dat: počet měsíců od posledního zveřejněného měsíce
  const [ly, lm] = s.lastMonth.split("-").map(Number);
  const now = new Date();
  const stale = (now.getFullYear() - ly!) * 12 + (now.getMonth() + 1 - lm!);
  const diff = s.prev12 ? Math.round(((s.last12 - s.prev12) / s.prev12) * 100) : null;
  return (
    <Card>
      <CardHeader title={t("ifs.stats")} subtitle={t("ifs.statsSubtitle")} action={action} />
      <div className="space-y-3 p-5" data-testid="info-stats">
        <p className="text-sm text-slate-700">
          {t("ifs.statsSummary", { last12: s.last12, last: s.lastMonth })}
          {diff != null && <span className={diff > 0 ? " text-red-700" : " text-emerald-700"}> {t("ifs.statsDiff", { d: diff > 0 ? `+${diff}` : String(diff) })}</span>}
        </p>
        {stale > 6 && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">{t("ifs.statsStale", { months: stale })}</p>}
        <Legend segments={usedSegments} />
        <StackedBars
          rows={rows}
          label={(r) => (
            <span className={d.manualMonths.includes(r.month) ? "font-medium text-slate-800" : undefined} title={d.manualMonths.includes(r.month) ? t("ifs.manualMonth") : undefined}>
              {r.month}
              {d.manualMonths.includes(r.month) && " ✎"}
            </span>
          )}
          segments={usedSegments}
          labelWidth="4.5rem"
          onClick={can("legislation:write") ? (r) => setEditing(r.month) : undefined}
        />
        <div className="text-xs text-slate-500">
          {t("ifs.severity")}: {s.severities.map((x) => `${x.name} ${x.count}`).join(" · ") || "—"}
        </div>
        <p className="text-xs text-slate-500">
          {d.manualMonths.length > 0 && <>{t("ifs.manualMonths", { months: d.manualMonths.join(", ") })} </>}
          {t("ifs.statsSource", { first: s.firstMonth ?? "", last: s.lastMonth })}{" "}
          <a href={NUKIB_OPENDATA_REPO} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">
            NUKIB/incidents-opendata
          </a>
        </p>
      </div>
      {modal}
    </Card>
  );
}

type BulkRow = { file: string; status: "waiting" | "running" | "done" | "error"; error?: string; month?: string | null; total?: number | null; classes?: { name: string; count: number }[]; severities?: { name: string; count: number }[]; warnings?: string[]; sourceUrl?: string; pick: boolean };

/** Hromadné doplnění měsíců z PDF přehledů NÚKIB (ADR-089): návrh AI pro každý soubor postupně, uloží se jen vybrané. */
function BulkModal({ d, onClose }: { d: InfoServiceDto; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const upd = (i: number, p: Partial<BulkRow>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const run = async () => {
    setBusy(true);
    setSaved(null);
    const init: BulkRow[] = files.map((f) => ({ file: f.name, status: "waiting", pick: false }));
    setRows(init);
    // postupně – lokální model zpracuje jeden přehled za druhým
    for (let i = 0; i < files.length; i++) {
      upd(i, { status: "running" });
      try {
        const r = await api.infoService.suggest({ file: files[i]! });
        const ok = !!r.month && (r.classes.length > 0 || r.severities.length > 0);
        upd(i, { status: "done", month: r.month, total: r.total, classes: r.classes, severities: r.severities, warnings: r.warnings, sourceUrl: r.sourceUrl, pick: ok && !r.warnings.length });
      } catch (e) {
        upd(i, { status: "error", error: e instanceof Error ? e.message : String(e) });
      }
    }
    setBusy(false);
  };
  const save = async () => {
    setBusy(true);
    setErr(null);
    let n = 0;
    try {
      for (const r of rows.filter((x) => x.pick && x.month)) {
        await api.infoService.saveMonth({ month: r.month!, classes: r.classes ?? [], severities: r.severities ?? [], sourceUrl: r.sourceUrl ?? "" });
        n++;
      }
    } catch (e) {
      setErr(e);
    }
    setSaved(n);
    setBusy(false);
    qc.invalidateQueries({ queryKey: ["infoservice"] });
  };
  const sum = (xs?: { count: number }[]) => (xs ?? []).reduce((a, x) => a + x.count, 0);
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("ifs.bulkTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button disabled={busy || !rows.some((x) => x.pick)} onClick={() => void save()}>
            {t("ifs.bulkSave", { n: rows.filter((x) => x.pick).length })}
          </Button>
        </>
      }
    >
      <div className="space-y-3" data-testid="bulk-pdf">
        <p className="text-sm text-slate-500">{t("ifs.bulkHint")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <input type="file" multiple accept=".pdf,application/pdf" className="text-sm" aria-label={t("ifs.bulkFiles")} onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 36))} />
          <Button variant="secondary" disabled={busy || !files.length} onClick={() => void run()}>
            <Sparkles size={14} /> {t("ifs.bulkRun", { n: files.length })}
          </Button>
        </div>
        {rows.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-1" />
                <th>{t("ifs.bulkFile")}</th>
                <th>{t("ifs.month")}</th>
                <th className="text-right">{t("ifs.byClass")}</th>
                <th className="text-right">{t("ifs.bySeverity")}</th>
                <th>{t("ifs.bulkNote")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-100 align-top">
                  <td className="py-1 pr-2">
                    <input type="checkbox" checked={r.pick} disabled={r.status !== "done" || !r.month} onChange={(e) => upd(i, { pick: e.target.checked })} aria-label={r.file} />
                  </td>
                  <td className="max-w-56 truncate pr-2" title={r.file}>
                    {r.file}
                  </td>
                  <td className="pr-2">
                    {r.month ? (
                      <>
                        {monthLabel(r.month, t.locale)}
                        {d.manualMonths.includes(r.month) && <span className="ml-1 text-xs text-amber-700">{t("ifs.bulkOverwrite")}</span>}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="text-right tabular-nums">{r.status === "done" ? sum(r.classes) : ""}</td>
                  <td className="text-right tabular-nums">{r.status === "done" ? sum(r.severities) : ""}</td>
                  <td className="text-xs">
                    {r.status === "waiting" && <span className="text-slate-400">{t("ifs.bulkWaiting")}</span>}
                    {r.status === "running" && <span className="text-violet-700">{t("ifs.suggesting")}</span>}
                    {r.status === "error" && <span className="text-red-700">{r.error}</span>}
                    {r.status === "done" && (r.warnings?.length ? r.warnings.map((w) => <div key={w} className="text-amber-800">⚠ {w}</div>) : <span className="text-emerald-700">{t("ifs.bulkOk")}</span>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {saved != null && <SuccessBox>{t("ifs.bulkSaved", { n: saved })}</SuccessBox>}
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

/** Výběr měsíce a roku (input type=month Safari nepodporuje); ✎ = měsíc už doplněný. */
function MonthPicker({ value, filled, onChange }: { value: string; filled: string[]; onChange: (m: string) => void }) {
  const t = useT();
  const [y, m] = value.split("-");
  const now = new Date().getFullYear();
  const years = Array.from({ length: now - 2021 + 1 }, (_, i) => String(now - i));
  const name = (i: number) => new Intl.DateTimeFormat(t.locale, { month: "long" }).format(new Date(2026, i, 1));
  return (
    <div className="flex gap-2">
      <Select className="w-40" value={m} aria-label={t("ifs.monthName")} onChange={(e) => onChange(`${y}-${e.target.value}`)}>
        {Array.from({ length: 12 }, (_, i) => {
          const mm = String(i + 1).padStart(2, "0");
          return (
            <option key={mm} value={mm}>
              {name(i)}
              {filled.includes(`${y}-${mm}`) ? " ✎" : ""}
            </option>
          );
        })}
      </Select>
      <Select className="w-28" value={y} aria-label={t("ifs.year")} onChange={(e) => onChange(`${e.target.value}-${m}`)}>
        {years.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </Select>
    </div>
  );
}

const monthLabel = (m: string, locale: string) => {
  const [y, mm] = m.split("-").map(Number);
  return y && mm ? new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(y, mm - 1, 1)) : m;
};

type Counts = Record<string, string>;
const toCounts = (xs: { name: string; count: number }[], base: readonly string[]): Counts => Object.fromEntries([...base.map((b) => [b, ""] as const), ...xs.map((x) => [x.name, String(x.count)] as const)]);
const fromCounts = (c: Counts) =>
  Object.entries(c)
    .map(([name, v]) => ({ name, count: Number(v) }))
    .filter((x) => v(x.count));
const v = (n: number) => Number.isInteger(n) && n > 0;

/** Doplnění měsíce z přehledu „Kybernetické incidenty pohledem NÚKIB“ – ručně, nebo návrh AI z PDF (potvrzuje člověk). */
function MonthModal({ d, initialMonth, onClose }: { d: InfoServiceDto; initialMonth: string; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [month, setMonth] = useState(initialMonth);
  const [classes, setClasses] = useState<Counts>(toCounts([], NUKIB_CLASSES));
  const [sevs, setSevs] = useState<Counts>(toCounts([], NUKIB_SEVERITIES));
  const [sourceUrl, setSourceUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState<{ model: string; warnings: string[]; total: number | null } | null>(null);
  const exists = d.manualMonths.includes(month);
  /** Jiný měsíc: vyčistit formulář (uložená čísla se načtou), případně vybrat přehled téhož měsíce. */
  const pickMonth = (m: string) => {
    if (m === month) return;
    setMonth(m);
    setNote(null);
    setLoadedFor(null);
    setClasses(toCounts([], NUKIB_CLASSES));
    setSevs(toCounts([], NUKIB_SEVERITIES));
    setSourceUrl("");
    setFile(null);
  };
  const existing = useQuery({ queryKey: ["infoservice", "month", month], queryFn: () => api.infoService.month(month), enabled: exists });
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (existing.data && loadedFor !== month && existing.data.month === month) {
    setLoadedFor(month);
    setClasses(toCounts(existing.data.classes, NUKIB_CLASSES));
    setSevs(toCounts(existing.data.severities, NUKIB_SEVERITIES));
  }
  const suggest = useMutation({
    mutationFn: () => {
      if (file) return api.infoService.suggest({ file });
      // přehled z aktualit (přesný odkaz na PDF), jinak dohledat podle názvu souboru na webu NÚKIB
      const item = d.reports.find((r) => r.month === month);
      return api.infoService.suggest(item ? { itemId: item.id } : { month });
    },
    onSuccess: (r) => {
      if (r.month) setMonth(r.month);
      setLoadedFor(r.month ?? month);
      setClasses(toCounts(r.classes, NUKIB_CLASSES));
      setSevs(toCounts(r.severities, NUKIB_SEVERITIES));
      setSourceUrl(r.sourceUrl);
      setNote({ model: r.model, warnings: r.warnings, total: r.total });
    },
  });
  const save = useMutation({
    mutationFn: () => api.infoService.saveMonth({ month, classes: fromCounts(classes), severities: fromCounts(sevs), sourceUrl }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["infoservice"] });
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.infoService.deleteMonth(month),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["infoservice"] });
      onClose();
    },
  });
  const sum = (c: Counts) => fromCounts(c).reduce((n, x) => n + x.count, 0);
  const grid = (c: Counts, set: (x: Counts) => void, label: string) => (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm font-medium text-slate-700">
        <span>{label}</span>
        <span className="text-xs font-normal text-slate-500">{t("ifs.sum", { n: sum(c) })}</span>
      </div>
      <div className="grid grid-cols-[1fr_5rem] gap-x-2 gap-y-1">
        {Object.keys(c).map((k) => (
          <label key={k} className="contents text-sm">
            <span className="self-center text-slate-600">{k}</span>
            <Input type="number" min={0} className="py-1 text-right" value={c[k]} aria-label={k} onChange={(e) => set({ ...c, [k]: e.target.value })} />
          </label>
        ))}
      </div>
    </div>
  );
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && (sum(classes) > 0 || sum(sevs) > 0);
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("ifs.monthTitle")}
      footer={
        <>
          {exists && (
            <Button variant="danger" className="mr-auto" disabled={remove.isPending} onClick={async () => (await askConfirm(t("ifs.monthDeleteConfirm", { month }))) && remove.mutate()}>
              {t("ifs.monthDelete")}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {t("usr.ulozit")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-500">{t("ifs.monthHint")}</p>
        <Field label={t("ifs.month")}>
          <MonthPicker value={month} filled={d.manualMonths} onChange={pickMonth} />
        </Field>
        {d.suggestAvailable && (
          <div className="rounded-md border border-violet-200 bg-violet-50/50 p-3" data-testid="stats-suggest">
            <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-violet-900">
              <Sparkles size={14} /> {t("ifs.suggestTitle")}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" disabled={suggest.isPending} onClick={() => suggest.mutate()}>
                <Sparkles size={14} /> {suggest.isPending ? t("ifs.suggesting") : file ? t("ifs.suggestFromFile", { name: file.name }) : t("ifs.suggestFor", { month: monthLabel(month, t.locale) })}
              </Button>
              <span className="text-xs text-slate-500">{t("ifs.orUpload")}</span>
              <input key={month} type="file" accept=".pdf,application/pdf" className="text-sm" aria-label={t("ifs.suggestFile")} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
            <p className="mt-1 text-xs text-slate-500">{t("ifs.suggestHint")}</p>
            <ErrorBox error={suggest.error} />
            {note && (
              <div className="mt-2 rounded bg-white px-3 py-2 text-xs text-slate-700">
                {t("ifs.suggested", { model: note.model, total: note.total ?? "—" })}
                {note.warnings.map((w) => (
                  <div key={w} className="text-amber-800">
                    ⚠ {w}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="grid gap-6 sm:grid-cols-2">
          {grid(classes, setClasses, t("ifs.byClass"))}
          {grid(sevs, setSevs, t("ifs.bySeverity"))}
        </div>
        {sum(classes) > 0 && sum(sevs) > 0 && sum(classes) !== sum(sevs) && <p className="text-xs text-amber-800">{t("ifs.sumMismatch", { a: sum(classes), b: sum(sevs) })}</p>}
        <Field label={t("ifs.sourceUrl")}>
          <Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://nukib.gov.cz/download/…pdf" />
        </Field>
        <ErrorBox error={save.error ?? remove.error} />
      </div>
    </Modal>
  );
}

function MispCard({ d }: { d: InfoServiceDto }) {
  const t = useT();
  const mod = useModule();
  const m = d.misp;
  return (
    <Card>
      <CardHeader title={t("ifs.misp")} subtitle={t("ifs.mispSubtitle")} />
      <div className="space-y-2 p-5 text-sm" data-testid="info-misp">
        {!m ? (
          <p className="text-slate-500">{mod("soc") ? t("ifs.mispNoAccess") : t("ifs.mispNoSoc")}</p>
        ) : m.enabled ? (
          <>
            <div className="flex items-center gap-2">
              <Share2 size={14} className="text-slate-400" />
              <span className="font-medium">{m.host ?? "—"}</span>
              {m.checkOk != null && <Badge tone={m.checkOk ? "green" : "red"}>{m.checkOk ? t("ifs.mispOk") : t("ifs.mispFail")}</Badge>}
            </div>
            <div className="text-slate-600">
              {m.pull ? (m.lastPull ? t("ifs.mispPull", { n: m.lastPull.count, at: fmtDate(m.lastPull.at) }) : t("ifs.mispPullNever")) : t("ifs.mispPullOff")}
              {m.lastPull?.error && <div className="text-xs text-red-700">{m.lastPull.error}</div>}
            </div>
          </>
        ) : (
          <p className="text-slate-600">{t("ifs.mispOff")}</p>
        )}
        <p className="text-xs text-slate-500">{t("ifs.mispHint")}</p>
        {m && (
          <Link to="/soc" search={{ tab: "sources" } as never} className="text-xs text-brand-700 hover:underline">
            {t("ifs.mispSettings")}
          </Link>
        )}
      </div>
    </Card>
  );
}

const STATUS_TONE: Record<InfoAssessmentStatus, Tone> = { assessing: "amber", affected: "red", not_applicable: "slate", resolved: "green" };

function LinkedRecord({ l }: { l: InfoAssessmentDto["links"][number] }) {
  const t = useT();
  const label = `${t(`ifs.link.${l.kind}`)}: ${l.label}`;
  if (l.kind === "risk") return <Link to="/risks/$riskId" params={{ riskId: l.targetId }} className="text-brand-700 hover:underline">{label}</Link>;
  if (l.kind === "incident") return <Link to="/incidents/$incidentId" params={{ incidentId: l.targetId }} className="text-brand-700 hover:underline">{label}</Link>;
  return <Link to="/actions" className="text-brand-700 hover:underline">{label}</Link>;
}

/** Posouzení dopadu položky za společnost (ADR-088): stav, závěr, odpovědnost, dotčená aktiva a navazující záznamy. */
function ReviewModal({ item, onClose }: { item: InfoFeedItemDto; onClose: () => void }) {
  const t = useT();
  const can = useCan();
  const mod = useModule();
  const qc = useQueryClient();
  const nav = useNavigate();
  const a = item.assessment;
  const [status, setStatus] = useState<InfoAssessmentStatus>(a?.status ?? "assessing");
  const [note, setNote] = useState(a?.note ?? "");
  const [owner, setOwner] = useState<string | null>(a?.ownerPositionId ?? null);
  const [due, setDue] = useState(a?.dueDate ?? "");
  const [assets, setAssets] = useState<PickedAsset[]>(a?.assets ?? []);
  const [links, setLinks] = useState(a?.links ?? []);
  const sugg = useMutation({ mutationFn: () => api.infoService.suggestAssets(item.id) });
  const payload = () => ({ status, note, ownerPositionId: owner, dueDate: due || null, assetIds: assets.map((x) => x.id) });
  const done = () => qc.invalidateQueries({ queryKey: ["infoservice"] });
  const save = useMutation({
    mutationFn: () => api.infoService.assess(item.id, payload()),
    onSuccess: () => {
      done();
      onClose();
    },
  });
  /** Navazující záznam: posouzení se nejdřív uloží (dotčeno), pak vznikne úkol / událost a vazba. */
  const create = useMutation({
    mutationFn: async (kind: "task" | "incident") => {
      const st = status === "assessing" || status === "not_applicable" ? "affected" : status;
      setStatus(st);
      const saved = await api.infoService.assess(item.id, { ...payload(), status: st });
      const desc = `${item.title}\n${item.link}\n\n${note}`.trim();
      const targetId =
        kind === "task"
          ? (await api.actions.create({ title: t("ifs.taskTitle", { title: item.title }).slice(0, 500), description: desc, sourceKind: "info_item", sourceId: saved.id, ownerPositionId: owner, dueDate: due || null, priority: item.kind === "warning" ? "high" : "medium" })).id
          : (await api.incidents.create({ title: item.title.slice(0, 300), description: desc, kind: "event", category: "other", detectedAt: new Date().toISOString(), ownerPositionId: owner, assetIds: assets.map((x) => x.id) })).id;
      return api.infoService.link(item.id, kind, targetId);
    },
    onSuccess: (r) => {
      setLinks(r.links);
      done();
    },
  });
  const toRisk = async () => {
    const st = status === "assessing" || status === "not_applicable" ? "affected" : status;
    await api.infoService.assess(item.id, { ...payload(), status: st });
    done();
    nav({ to: "/risks/new", search: { infoItem: item.id } as never });
  };
  const addAsset = (x: PickedAsset) => setAssets((v) => (v.some((y) => y.id === x.id) ? v : [...v, x]));
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("ifs.reviewTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {t("ifs.reviewSave")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="font-medium">{item.title}</p>
          <p className="text-sm text-slate-500">{item.kind === "warning" ? t("ifs.reviewHintWarning") : t("ifs.reviewHint")}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("ifs.status")}>
            <Select value={status} onChange={(e) => setStatus(e.target.value as InfoAssessmentStatus)}>
              {INFO_ASSESSMENT_STATUSES.map((x) => (
                <option key={x} value={x}>
                  {t.lbl(INFO_ASSESSMENT_LABELS[x])}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("ifs.owner")}>
            <PositionSelect value={owner} onChange={setOwner} ariaLabel={t("ifs.owner")} />
          </Field>
          <Field label={t("ifs.dueDate")}>
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
        <Field label={t("ifs.reviewNote")}>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("ifs.reviewPlaceholder")} />
        </Field>
        {mod("assets") && can("assets:read") && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">{t("ifs.affectedAssets")}</span>
              <Button variant="secondary" className="px-2 py-0.5 text-xs" disabled={sugg.isPending} onClick={() => sugg.mutate()}>
                <Sparkles size={13} /> {t("ifs.suggestAssets")}
              </Button>
            </div>
            <AssetPicker value={assets} onChange={setAssets} />
            <ErrorBox error={sugg.error} />
            {sugg.data && (
              <div className="mt-2 rounded-md border border-slate-200 p-2 text-sm" data-testid="asset-suggestions">
                {sugg.data.length ? (
                  <>
                    <div className="mb-1 text-xs text-slate-500">{t("ifs.suggestAssetsHint")}</div>
                    <ul className="space-y-0.5">
                      {sugg.data.map((x) => (
                        <li key={x.id} className="flex items-center gap-2">
                          <Button variant="secondary" className="px-1.5 py-0 text-xs" disabled={assets.some((y) => y.id === x.id)} onClick={() => addAsset({ id: x.id, name: x.name })}>
                            <Plus size={12} />
                          </Button>
                          <span>{x.name}</span>
                          <span className="text-xs text-slate-500">({x.reason})</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <span className="text-xs text-slate-500">{t("ifs.noAssetMatch")}</span>
                )}
              </div>
            )}
          </div>
        )}
        <div className="rounded-md border border-slate-200 p-3">
          <div className="mb-2 text-sm font-medium text-slate-700">{t("ifs.followUp")}</div>
          {links.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
              {links.map((l) => (
                <LinkedRecord key={l.kind + l.targetId} l={l} />
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {mod("risks") && can("risks:write") && (
              <Button variant="secondary" onClick={() => void toRisk()}>
                {t("ifs.createRisk")}
              </Button>
            )}
            {can("actions:write") && (
              <Button variant="secondary" disabled={create.isPending} onClick={() => create.mutate("task")}>
                {t("ifs.createTask")}
              </Button>
            )}
            {mod("incidents") && can("incidents:write") && (
              <Button variant="secondary" disabled={create.isPending} onClick={() => create.mutate("incident")}>
                {t("ifs.createEvent")}
              </Button>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">{t("ifs.followUpHint")}</p>
          <ErrorBox error={create.error} />
        </div>
        <ErrorBox error={save.error} />
        <RelatedRecordsCard text={`${item.title}\n${item.summary}`.slice(0, 2000)} kinds={["vulnerability", "incident", "risk", "cra_finding", "ai_system"]} title={t("ifs.relatedTitle")} />
      </div>
    </Modal>
  );
}

function SettingsModal({ d, onClose }: { d: InfoServiceDto; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [f, setF] = useState<InfoServiceSettingsInput>(structuredClone(d.settings));
  const [upSource, setUpSource] = useState(d.settings.feeds[0]?.id ?? "opendata");
  const [file, setFile] = useState<File | null>(null);
  const save = useMutation({
    mutationFn: () => api.infoService.save(f),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["infoservice"] });
      onClose();
    },
  });
  const upload = useMutation({ mutationFn: () => api.infoService.upload(upSource, file!), onSuccess: () => qc.invalidateQueries({ queryKey: ["infoservice"] }) });
  const feeds = f.feeds ?? [];
  const setFeed = (i: number, patch: Partial<(typeof feeds)[number]>) => setF({ ...f, feeds: feeds.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("ifs.settingsTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {t("usr.ulozit")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <Checkbox checked={f.autoRefresh} onChange={(v) => setF({ ...f, autoRefresh: v })} label={t("ifs.auto")} />
          <Field label={t("ifs.interval")}>
            <Input type="number" min={1} max={168} className="w-24" value={f.intervalHours} onChange={(e) => setF({ ...f, intervalHours: Number(e.target.value) || 6 })} />
          </Field>
        </div>
        <div>
          <div className="mb-1.5 text-sm font-medium text-slate-700">{t("ifs.feeds")}</div>
          <div className="space-y-2">
            {feeds.map((x, i) => (
              <div key={i} className="space-y-1 rounded-md border border-slate-100 p-2">
              <div className="grid grid-cols-[auto_6rem_9rem_7rem_4.5rem_1fr_auto] items-center gap-2">
                <Checkbox checked={x.enabled ?? true} onChange={(v) => setFeed(i, { enabled: v })} label="" />
                <Input value={x.id} onChange={(e) => setFeed(i, { id: e.target.value })} aria-label={t("ifs.feedKey")} placeholder="nukib" />
                <Input value={x.name} onChange={(e) => setFeed(i, { name: e.target.value })} aria-label={t("ifs.feedName")} />
                <Input value={x.publisher ?? ""} onChange={(e) => setFeed(i, { publisher: e.target.value })} aria-label={t("ifs.publisher")} placeholder="NÚKIB" />
                <Select value={x.country ?? ""} onChange={(e) => setFeed(i, { country: e.target.value })} aria-label={t("ifs.country")}>
                  <option value="">{t("ifs.countryAny")}</option>
                  {["CZ", "SK", "PL", "DE", "AT", "EU"].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
                <Input value={x.url} onChange={(e) => setFeed(i, { url: e.target.value })} aria-label={t("ifs.feedUrl")} placeholder="https://…/rss.xml" />
                <Button variant="secondary" className="px-2" onClick={() => setF({ ...f, feeds: feeds.filter((_, j) => j !== i) })} aria-label={t("ifs.removeFeed")}>
                  ✕
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-7 text-xs">
                <Select className="w-44 py-1 text-xs" value={x.format ?? "rss"} onChange={(e) => setFeed(i, { format: e.target.value as "rss" | "html" })} aria-label={t("ifs.feedFormat")}>
                  <option value="rss">{t("ifs.formatRss")}</option>
                  <option value="html">{t("ifs.formatHtml")}</option>
                </Select>
                {x.format === "html" && (
                  <Input className="w-80 py-1 text-xs" value={x.linkPrefix ?? ""} onChange={(e) => setFeed(i, { linkPrefix: e.target.value })} aria-label={t("ifs.linkPrefix")} placeholder="/cs/kyberbezpecnost/aktualne-z-bezpecnosti/" />
                )}
                <Select className="w-52 py-1 text-xs" value={x.defaultKind ?? ""} onChange={(e) => setFeed(i, { defaultKind: (e.target.value || undefined) as FeedItemKind | undefined })} aria-label={t("ifs.defaultKind")}>
                  <option value="">{t("ifs.defaultKindAuto")}</option>
                  {FEED_ITEM_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t("ifs.defaultKindIs", { kind: t.lbl(FEED_ITEM_LABELS[k]) })}
                    </option>
                  ))}
                </Select>
              </div>
              </div>
            ))}
          </div>
          {feeds.length < 10 && (
            <Button variant="secondary" className="mt-2 text-xs" onClick={() => setF({ ...f, feeds: [...feeds, { id: `zdroj-${feeds.length + 1}`, name: "", url: "", enabled: true, publisher: "", country: "", format: "rss", linkPrefix: "" }] })}>
              {t("ifs.addFeed")}
            </Button>
          )}
          <p className="mt-1 text-xs text-slate-500">{t("ifs.feedsHint")}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Checkbox checked={f.opendataEnabled} onChange={(v) => setF({ ...f, opendataEnabled: v })} label={t("ifs.opendataOn")} />
          <Field label={t("ifs.opendataUrl")} className="min-w-80 flex-1">
            <Input value={f.opendataUrl} onChange={(e) => setF({ ...f, opendataUrl: e.target.value })} />
          </Field>
        </div>
        <ErrorBox error={save.error} />
        <div className="rounded-md border border-slate-200 p-3">
          <div className="mb-2 text-sm font-medium text-slate-700">{t("ifs.upload")}</div>
          <div className="flex flex-wrap items-center gap-2">
            <Select className="w-48" value={upSource} onChange={(e) => setUpSource(e.target.value)} aria-label={t("ifs.uploadSource")}>
              {d.settings.feeds.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} (RSS)
                </option>
              ))}
              <option value="opendata">{t("ifs.opendata")} (CSV)</option>
            </Select>
            <input type="file" accept=".xml,.rss,.csv,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" aria-label={t("ifs.uploadFile")} />
            <Button variant="secondary" disabled={!file || upload.isPending} onClick={() => upload.mutate()}>
              <Upload size={14} /> {t("ifs.uploadButton")}
            </Button>
          </div>
          <p className="mt-1 text-xs text-slate-500">{t("ifs.uploadHint")}</p>
          <ErrorBox error={upload.error} />
          {upload.data && <SuccessBox>{t("ifs.uploaded", { n: upload.data.count })}</SuccessBox>}
        </div>
      </div>
    </Modal>
  );
}

