/**
 * Pokrytí předpisu (v0.42, ADR-038): matice ustanovení × dokumenty (AI verdikt lokálního modelu) × opatření,
 * hromadné AI skóre dokumentů a snímky stavu pro audit.
 */
import { FrameworkOptions } from "@/components/frameworkOptions";
import { FrameworkBadge } from "@/components/frameworkBadge";
import { NeedsCompany, useGroupView } from "@/components/company";
import { useDecree } from "@/lib/regime";
import { complianceTone } from "@/components/compliance";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, SuccessBox, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useModule } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn, fmtDate } from "@/lib/utils";
import { COVERAGE_GAPS, COVERAGE_LABELS, FRAMEWORKS, type CoverageBatchStatus, type CoverageDocState, type CoverageGap, type CoverageRow, type FrameworkId, type GapStatus, type Translate } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { AlertTriangle, Camera, Download, FileText, ListChecks, Sparkles, Target } from "lucide-react";
import { useMemo, useState } from "react";

const aiTone: Record<CoverageDocState, Tone> = { covered: "green", partial: "amber", missing: "red", unscored: "slate", none: "slate" };
const aiDot: Record<GapStatus | "unscored", string> = { covered: "bg-emerald-500", partial: "bg-amber-500", missing: "bg-red-500", unscored: "bg-slate-300" };
const gapTone: Record<CoverageGap, Tone> = { no_document: "red", ai_missing: "red", ai_partial: "amber", no_control: "amber", not_compliant: "amber" };

const docStateLabel = (t: Translate, s: CoverageDocState) => t.dyn(`enum.coverage.docState.${s}`, COVERAGE_LABELS.docState[s]);
const gapLabel = (t: Translate, g: CoverageGap) => t.dyn(`enum.coverage.gap.${g}`, COVERAGE_LABELS.gap[g]);
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

export function CoveragePage() {
  const t = useT();
  const can = useCan();
  const mod = useModule();
  const nav = useNavigate();
  const qc = useQueryClient();
  const group = useGroupView();
  const search = useSearch({ from: "/app/controls/coverage" });
  const decree = useDecree();
  const fw: FrameworkId = search.framework ?? decree;
  const snapshotId = search.snapshot ?? null;
  const setSearch = (s: { framework?: FrameworkId; snapshot?: string | null }) =>
    nav({ to: "/controls/coverage", search: { framework: s.framework ?? fw, snapshot: s.snapshot === undefined ? (snapshotId ?? undefined) : (s.snapshot ?? undefined) } });

  const live = useQuery({
    queryKey: ["coverage", fw],
    queryFn: () => api.coverage.get(fw),
    enabled: !group && !snapshotId,
    // během hromadného hodnocení obnovovat
    refetchInterval: (q) => (q.state.data?.batch.running ? 4000 : false),
  });
  const snaps = useQuery({ queryKey: ["coverage", "snapshots", fw], queryFn: () => api.coverage.snapshots(fw), enabled: !group });
  const snap = useQuery({ queryKey: ["coverage", "snapshot", snapshotId], queryFn: () => api.coverage.snapshot(snapshotId!), enabled: !!snapshotId });
  const data = snapshotId ? snap.data : live.data;
  const batch = live.data?.batch;

  const [q, setQ] = useState("");
  const [section, setSection] = useState("");
  const [filter, setFilter] = useState<"" | "gaps" | "unscored" | CoverageGap>("");
  const [scoring, setScoring] = useState(false);
  const [saving, setSaving] = useState(false);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.rows ?? []).filter(
      (r) =>
        (!section || r.section === section) &&
        (!s || `${r.ref} ${r.text} ${r.docs.map((d) => `${d.code ?? ""} ${d.title}`).join(" ")}`.toLowerCase().includes(s)) &&
        (!filter || (filter === "gaps" ? r.gaps.length > 0 : filter === "unscored" ? r.docState === "unscored" : r.gaps.includes(filter))),
    );
  }, [data, q, section, filter]);
  const sections = useMemo(() => [...new Map((data?.rows ?? []).map((r) => [r.section, r.sectionTitle])).entries()], [data]);
  const grouped = useMemo(() => {
    const m = new Map<string, CoverageRow[]>();
    for (const r of rows) m.set(r.section, [...(m.get(r.section) ?? []), r]);
    return [...m.entries()];
  }, [rows]);

  if (group)
    return (
      <>
        <PageHeader badge={<FrameworkBadge />} title={t("cov.title")} subtitle={t("cov.subtitle")} />
        <NeedsCompany what={t("cov.title")}>{null}</NeedsCompany>
      </>
    );
  const sm = data?.summary;
  const docsVisible = can("policies:read") && mod("policies");
  const canScore = !snapshotId && docsVisible && can("ai:use");
  const fwMeta = FRAMEWORKS.find((f) => f.id === fw);
  const toScore = live.data?.documents.filter((d) => !d.scored || d.stale).length ?? 0;

  return (
    <>
      <PageHeader
        title={t("cov.title")}
        subtitle={t("cov.subtitle")}
        actions={
          <>
            <a href={api.coverage.exportUrl(fw, snapshotId)} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50">
              <Download size={15} /> {t("soa.csv")}
            </a>
            {!snapshotId && can("controls:write") && (
              <Button variant="secondary" onClick={() => setSaving(true)}>
                <Camera size={15} /> {t("cov.snapshot.save")}
              </Button>
            )}
            {canScore && (
              <Button disabled={batch?.running} onClick={() => setScoring(true)}>
                <Sparkles size={15} /> {batch?.running ? t("cov.ai.running") : t("cov.ai.button")}
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label={t("cov.framework")} className="w-72">
          <Select value={fw} onChange={(e) => setSearch({ framework: e.target.value as FrameworkId, snapshot: null })}>
            <FrameworkOptions label="name" />
          </Select>
        </Field>
        <Field label={t("cov.snapshot.view")} className="w-72">
          <Select value={snapshotId ?? ""} onChange={(e) => setSearch({ snapshot: e.target.value || null })}>
            <option value="">{t("cov.snapshot.current")}</option>
            {(snaps.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {fmtDate(s.createdAt)}
                {s.note ? ` – ${s.note.slice(0, 40)}` : ""}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <ErrorBox error={live.error ?? snap.error ?? snaps.error} />
      {snapshotId && snap.data && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <Camera size={16} className="mt-0.5 shrink-0" />
          <span>
            {t("cov.snapshot.banner", { date: fmtDate(snap.data.createdAt), name: snap.data.createdByName ?? "—" })}
            {snap.data.note ? ` ${snap.data.note}` : ""}
          </span>
        </div>
      )}
      {batch && (batch.running || batch.finishedAt) && !snapshotId && <BatchBar batch={batch} />}

      {sm && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi icon={<Target size={16} />} label={t("cov.kpi.requirements")} value={sm.applicable} note={t("cov.kpi.requirementsNote", { total: sm.total, na: sm.total - sm.applicable })} />
          {docsVisible && (
            <Kpi
              icon={<FileText size={16} />}
              label={t("cov.kpi.documented")}
              value={`${pct(sm.withDocs, sm.applicable)} %`}
              note={t("cov.kpi.documentedNote", { n: sm.withDocs, of: sm.applicable })}
              tone={sm.withDocs < sm.applicable ? "amber" : "green"}
              onClick={() => setFilter("no_document")}
            />
          )}
          {docsVisible && (
            <Kpi
              icon={<Sparkles size={16} />}
              label={t("cov.kpi.ai")}
              value={sm.docScore == null ? "–" : `${sm.docScore} %`}
              note={t("cov.kpi.aiNote", { covered: sm.aiCovered, partial: sm.aiPartial, missing: sm.aiMissing, unscored: sm.unscored })}
              tone={sm.aiMissing ? "red" : sm.aiPartial ? "amber" : "green"}
              onClick={() => setFilter(sm.unscored ? "unscored" : "gaps")}
            />
          )}
          <Kpi
            icon={<ListChecks size={16} />}
            label={t("cov.kpi.controls")}
            value={`${pct(sm.withControls, sm.applicable)} %`}
            note={t("cov.kpi.controlsNote", { n: sm.withControls, compliant: sm.compliant })}
            tone={sm.withControls < sm.applicable ? "amber" : "green"}
            onClick={() => setFilter("no_control")}
          />
          {!docsVisible && <Kpi icon={<AlertTriangle size={16} />} label={t("cov.kpi.gaps")} value={sm.withGaps} note={t("cov.kpi.gapsNote")} tone={sm.withGaps ? "amber" : "green"} onClick={() => setFilter("gaps")} />}
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <Select className="w-64" value={section} onChange={(e) => setSection(e.target.value)} aria-label={t("cov.filter.section")}>
            <option value="">{t("cov.filter.allSections")}</option>
            {sections.map(([s, title]) => (
              <option key={s} value={s}>
                {s} – {title}
              </option>
            ))}
          </Select>
          <Select className="w-60" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label={t("cov.filter.state")}>
            <option value="">{t("cov.filter.all")}</option>
            <option value="gaps">{t("cov.filter.gaps", { n: sm?.withGaps ?? 0 })}</option>
            {docsVisible && <option value="unscored">{t("cov.filter.unscored")}</option>}
            {COVERAGE_GAPS.filter((g) => docsVisible || (g !== "no_document" && !g.startsWith("ai_"))).map((g) => (
              <option key={g} value={g}>
                {gapLabel(t, g)}
              </option>
            ))}
          </Select>
          <Input className="max-w-xs" placeholder={t("cov.filter.search")} value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="ml-auto text-xs text-slate-500">{t("cov.filter.count", { n: rows.length, total: data?.rows.length ?? 0 })}</span>
        </div>
        {!data ? (
          <EmptyState>{t("common.loading")}</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState>{t("cov.empty")}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-36 px-5 py-2">{t("cov.col.ref")}</th>
                  <th className="px-3 py-2">{t("cov.col.requirement")}</th>
                  {docsVisible && <th className="w-72 px-3 py-2">{t("cov.col.documents")}</th>}
                  <th className="w-56 px-3 py-2">{t("cov.col.controls")}</th>
                  <th className="w-44 px-3 py-2">{t("cov.col.gaps")}</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(([sec, list]) => (
                  <SectionRows key={sec} section={sec} rows={list} docsVisible={docsVisible} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {fwMeta && !fwMeta.fullText && <p className="mt-2 text-xs text-slate-500">{t("cov.labelsOnly")}</p>}

      {docsVisible && !snapshotId && live.data && live.data.documents.length > 0 && (
        <Card className="mt-6 overflow-hidden">
          <CardHeader title={t("cov.docs.title")} subtitle={t("cov.docs.subtitle")} />
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2">{t("cov.docs.document")}</th>
                <th className="px-3 py-2">{t("cov.docs.requirements")}</th>
                <th className="px-3 py-2">{t("cov.docs.score")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {live.data.documents.map((d) => (
                <tr key={d.id}>
                  <td className="px-5 py-2">
                    <Link to="/policies/$policyId" params={{ policyId: d.id }} className="font-medium hover:text-brand-700">
                      {d.code ? `${d.code} ` : ""}
                      {d.title}
                    </Link>
                    {d.status === "draft" && <span className="ml-2 text-xs text-slate-500">{t("cov.docs.draft")}</span>}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{d.requirements}</td>
                  <td className="px-3 py-2">
                    {!d.scored ? (
                      <Badge tone="slate">{t("cov.docs.unscored")}</Badge>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <span className="tabular-nums font-medium">{d.score == null ? "–" : `${d.score} %`}</span>
                        {d.stale && <Badge tone="amber">{t("cov.docs.stale")}</Badge>}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {scoring && live.data && <ScoreModal framework={fw} toScore={toScore} all={live.data.documents.length} onClose={() => setScoring(false)} onStarted={() => qc.invalidateQueries({ queryKey: ["coverage", fw] })} />}
      {saving && (
        <SnapshotModal
          framework={fw}
          onClose={() => setSaving(false)}
          onSaved={(id) => {
            qc.invalidateQueries({ queryKey: ["coverage", "snapshots", fw] });
            setSaving(false);
            setSearch({ snapshot: id });
          }}
        />
      )}
    </>
  );
}

function SectionRows({ section, rows, docsVisible }: { section: string; rows: CoverageRow[]; docsVisible: boolean }) {
  const t = useT();
  const gaps = rows.filter((r) => r.gaps.length).length;
  return (
    <>
      <tr className="border-t border-slate-200 bg-slate-50/70">
        <td colSpan={docsVisible ? 5 : 4} className="px-5 py-2 text-xs font-semibold text-slate-700">
          {section} – {rows[0]!.sectionTitle}
          <span className="ml-2 font-normal text-slate-500">{gaps ? t("cov.section.gaps", { n: gaps, of: rows.length }) : t("cov.section.ok", { of: rows.length })}</span>
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.id} className={cn("border-t border-slate-100 align-top", !r.applicable && "text-slate-400")}>
          <td className="px-5 py-2.5 text-xs font-medium whitespace-nowrap">{r.ref}</td>
          <td className="px-3 py-2.5">
            <div className="line-clamp-3" title={r.text}>
              {r.text}
            </div>
            {!r.applicable && <div className="mt-0.5 text-xs">{t("cov.notApplicable")}</div>}
          </td>
          {docsVisible && (
            <td className="px-3 py-2.5">
              {r.docs.length === 0 ? (
                <span className="text-xs text-slate-400">—</span>
              ) : (
                <div className="space-y-1">
                  {r.docs.map((d) => (
                    <div key={d.id} className="flex items-start gap-1.5 text-xs" title={d.aiReason ?? undefined}>
                      <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", aiDot[d.ai ?? "unscored"])} />
                      <span>
                        <Link to="/policies/$policyId" params={{ policyId: d.id }} className="font-medium hover:text-brand-700">
                          {d.code ?? d.title}
                        </Link>{" "}
                        <span className="text-slate-500">
                          {docStateLabel(t, d.ai ?? "unscored")}
                          {d.aiStale ? ` · ${t("cov.docs.stale")}` : ""}
                          {d.via === "section" ? ` · ${t("cov.viaSection")}` : ""}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </td>
          )}
          <td className="px-3 py-2.5">
            {r.controls.length === 0 ? (
              <span className="text-xs text-slate-400">—</span>
            ) : (
              <div className="space-y-1">
                {r.controls.map((c) => (
                  <div key={c.id} className="text-xs">
                    <Link to="/controls/$controlId" params={{ controlId: c.id }} className="font-medium hover:text-brand-700">
                      {c.code ?? c.name}
                    </Link>
                    {c.code && <span className="text-slate-500"> {c.name}</span>}
                  </div>
                ))}
                <Badge tone={complianceTone[r.compliance]}>{t.dyn(`enum.compliance.${r.compliance}`, r.compliance)}</Badge>
              </div>
            )}
          </td>
          <td className="px-3 py-2.5">
            {r.gaps.length === 0 ? (
              r.applicable && <Badge tone={aiTone[r.docState === "none" || r.docState === "unscored" ? "covered" : r.docState]}>{t("cov.noGap")}</Badge>
            ) : (
              <div className="flex flex-wrap gap-1">
                {r.gaps.map((g) => (
                  <Badge key={g} tone={gapTone[g]}>
                    {gapLabel(t, g)}
                  </Badge>
                ))}
              </div>
            )}
          </td>
        </tr>
      ))}
    </>
  );
}

function BatchBar({ batch }: { batch: CoverageBatchStatus }) {
  const t = useT();
  const p = batch.total ? Math.round((batch.done / batch.total) * 100) : 0;
  return (
    <div className={cn("mb-4 rounded-md border px-4 py-3 text-sm", batch.running ? "border-brand-200 bg-brand-50 text-brand-900" : batch.failed ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900")}>
      <div className="flex items-center justify-between gap-3">
        <span>
          {batch.running
            ? t("cov.ai.progress", { done: batch.done, total: batch.total, current: batch.current ?? "" })
            : t("cov.ai.finished", { done: batch.done - batch.failed, total: batch.total, failed: batch.failed })}
        </span>
        <span className="tabular-nums">{p} %</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/70">
        <div className="h-full bg-brand-500 transition-all" style={{ width: `${p}%` }} />
      </div>
      {!batch.running && batch.errors.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
          {batch.errors.slice(0, 8).map((e, i) => (
            <li key={i}>
              {e.document ? `${e.document}: ` : ""}
              {e.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ScoreModal({ framework, toScore, all, onClose, onStarted }: { framework: FrameworkId; toScore: number; all: number; onClose: () => void; onStarted: () => void }) {
  const t = useT();
  const [onlyStale, setOnlyStale] = useState(true);
  const start = useMutation({
    mutationFn: () => api.coverage.score({ framework, onlyStale }),
    onSuccess: () => (onStarted(), onClose()),
  });
  const n = onlyStale ? toScore : all;
  return (
    <Modal
      open
      onClose={onClose}
      title={t("cov.ai.title")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button disabled={!n || start.isPending} onClick={() => start.mutate()}>
            <Sparkles size={15} /> {t("cov.ai.start", { n })}
          </Button>
        </>
      }
    >
      <ErrorBox error={start.error} />
      <p className="text-sm text-slate-600">{t("cov.ai.explain")}</p>
      <Checkbox checked={onlyStale} onChange={setOnlyStale} label={t("cov.ai.onlyStale", { n: toScore })} hint={t("cov.ai.onlyStaleHint")} />
      {!n && <SuccessBox>{t("cov.ai.nothing")}</SuccessBox>}
    </Modal>
  );
}

function SnapshotModal({ framework, onClose, onSaved }: { framework: FrameworkId; onClose: () => void; onSaved: (id: string) => void }) {
  const t = useT();
  const [note, setNote] = useState("");
  const save = useMutation({ mutationFn: () => api.coverage.createSnapshot({ framework, note: note.trim() || null }), onSuccess: (s) => onSaved(s.id) });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("cov.snapshot.title")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            <Camera size={15} /> {t("cov.snapshot.save")}
          </Button>
        </>
      }
    >
      <ErrorBox error={save.error} />
      <p className="text-sm text-slate-600">{t("cov.snapshot.explain")}</p>
      <Field label={t("cov.snapshot.note")}>
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("cov.snapshot.notePlaceholder")} />
      </Field>
    </Modal>
  );
}

const kpiTone = { slate: "text-slate-500", amber: "text-amber-700", red: "text-red-700", green: "text-emerald-700" } as const;
function Kpi({ icon, label, value, note, tone = "slate", onClick }: { icon: React.ReactNode; label: string; value: React.ReactNode; note: string; tone?: keyof typeof kpiTone; onClick?: () => void }) {
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
