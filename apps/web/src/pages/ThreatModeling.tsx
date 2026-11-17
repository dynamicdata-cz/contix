/**
 * Modelování hrozeb podle reality prostředí (v1.40, ADR-137): útočné cesty z grafu aktiv, kalibrace hodnocení z dat,
 * aktéři hrozeb pro odvětví a řízený threat modeling STRIDE. Nic se nepoužije samo – riziko, kalibraci i rozhodnutí
 * o relevanci potvrzuje člověk; server vše znovu spočítá z aktuálních dat.
 */
import { useRiskNav } from "@/components/riskNav";
import { AssetPicker, type PickedAsset } from "@/components/pickers";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Facts, Field, Input, Modal, PageHeader, Select, Textarea, type Tone } from "@/components/ui";
import { askConfirm, toast } from "@/components/ui/overlay";
import { Tabs, useTab } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn, fmtDay } from "@/lib/utils";
import {
  RISK_SCENARIO_LABELS,
  SECTORS,
  SECTOR_LABELS,
  STRIDE,
  TM_AUTH,
  TM_DATA,
  TM_ELEMENT_KINDS,
  TM_LABELS,
  TM_SCOPES,
  TM_STATUSES,
  TM_THREAT_STATUSES,
  TM_ZONES,
  ZONE_TRUST,
  attackTechnique,
  calibrationPriority,
  pathPriority,
  type ModelingOverviewDto,
  type ModelingStep,
  type ReadinessItem,
  type ActorRelevance,
  type ActorRelevanceDto,
  type AttackPathDto,
  type CalibrationDto,
  type Reason,
  type Sector,
  type Stride,
  type ThreatLandscapeDto,
  type ThreatModelDto,
  type TmElement,
  type TmElementKind,
  type TmScope,
  type TmThreat,
  type TmThreatStatus,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Check, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, HelpCircle, Lightbulb, X, Download, FileText, Globe, Mail, Plus, Route, ShieldAlert, Trash2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

const relTone: Record<ActorRelevance, Tone> = { high: "red", medium: "amber", low: "slate" };
const sevTone = (s: number): Tone => (s >= 4 ? "red" : s >= 3 ? "amber" : s >= 2 ? "blue" : "slate");
const tStatusTone: Record<TmThreatStatus, Tone> = { open: "amber", mitigate: "blue", accepted: "slate", not_applicable: "slate", risk: "green" };
const techName = (id: string) => attackTechnique(id)?.name ?? "";

function useReason() {
  const t = useT();
  return (r: Reason) => t.dyn(r.text, r.text, r.params as Record<string, string | number> | undefined);
}

export function ThreatModelingPage() {
  const t = useT();
  const riskNav = useRiskNav();
  const keys = ["paths", "calibration", "landscape", "models"] as const;
  const [tab, setTab] = useTab(keys, "paths");
  const ov = useQuery({ queryKey: ["modeling", "overview"], queryFn: api.modeling.overview });
  const c = ov.data?.counts;
  const badge = (n: number | undefined, tone = "bg-amber-100 text-amber-900") => (n ? <span className={cn("ml-1.5 rounded-full px-1.5 text-xs tabular-nums", tone)}>{n}</span> : null);
  const badges: Record<(typeof keys)[number], ReactNode> = {
    paths: badge(c?.pathsOpen),
    calibration: badge(c ? c.drift + c.unrated : 0),
    landscape: ov.data && !ov.data.sector ? badge(1, "bg-brand-100 text-brand-800") : null,
    models: badge(c?.openThreats),
  };
  return (
    <>
      <PageHeader nav={riskNav} title={t("tm.title")} subtitle={t("tm.subtitle")} />
      {ov.data && <Process ov={ov.data} onGo={(k) => setTab(k)} />}
      <Tabs label={t("tm.title")} value={tab} onChange={setTab} items={keys.map((k) => ({ key: k, label: t(`tm.tab.${k}`), badge: badges[k] }))} />
      <Guide id={tab} />
      {tab === "paths" ? <Paths /> : tab === "calibration" ? <Calibration /> : tab === "landscape" ? <Landscape /> : <Models />}
    </>
  );
}

/* ---------------- postup a nápověda (v1.41) ---------------- */

/** Příznak uložený v prohlížeči (skrytý panel / nápověda) – bez úložiště výchozí hodnota. */
function useStoredFlag(key: string, def: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState<boolean>(() => {
    try {
      const x = localStorage.getItem(key);
      return x == null ? def : x === "1";
    } catch {
      return def;
    }
  });
  return [
    v,
    (n: boolean) => {
      setV(n);
      try {
        localStorage.setItem(key, n ? "1" : "0");
      } catch {
        /* prohlížeč bez úložiště */
      }
    },
  ];
}

const STEP_TAB: Record<ModelingStep, "paths" | "calibration" | "landscape" | "models" | null> = { sector: "landscape", data: null, paths: "paths", calibration: "calibration", models: "models" };

function Process({ ov, onGo }: { ov: ModelingOverviewDto; onGo: (k: "paths" | "calibration" | "landscape" | "models") => void }) {
  const t = useT();
  const [open, setOpen] = useStoredFlag("contix.tm.process", true);
  const [showData, setShowData] = useState(ov.next === "data" || ov.readiness.find((r) => r.key === "crown_jewels")?.status !== "ok");
  const go = (k: ModelingStep) => {
    if (k === "data") {
      setOpen(true);
      return setShowData(true);
    }
    onGo(STEP_TAB[k]!);
  };
  const done = ov.steps.filter((s) => s.state === "done").length;
  return (
    <Card className="mb-4" data-testid="tm-process">
      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
          <ChevronDown size={16} className={cn("shrink-0 text-slate-400 transition", !open && "-rotate-90")} />
          <span className="text-sm font-semibold text-slate-900">{t("tm.proc.title")}</span>
          <span className="text-xs tabular-nums text-slate-500">{t("tm.proc.progress", { d: done, n: ov.steps.length })}</span>
        </button>
        {ov.next ? (
          <Button className="px-2.5 py-1 text-xs" onClick={() => go(ov.next!)}>
            {t("tm.proc.next", { s: t(`tm.proc.step.${ov.next}`) })} <ArrowRight size={14} />
          </Button>
        ) : (
          <Badge tone="green">{t("tm.proc.allDone")}</Badge>
        )}
      </div>
      {open && (
        <>
          <ol className="grid gap-2 border-t border-slate-100 px-5 py-3 sm:grid-cols-2 lg:grid-cols-5">
            {ov.steps.map((s, i) => {
              const cur = ov.next === s.key;
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => go(s.key)}
                    aria-current={cur ? "step" : undefined}
                    className={cn("flex h-full w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition hover:bg-slate-50", cur ? "border-brand-400 ring-2 ring-brand-100" : "border-slate-200")}
                    data-testid={`tm-step-${s.key}`}
                  >
                    <span className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold", s.state === "done" ? "bg-emerald-100 text-emerald-700" : cur ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600")}>
                      {s.state === "done" ? <Check size={14} /> : i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-slate-900">{t(`tm.proc.step.${s.key}`)}</span>
                      <span className="block text-xs text-slate-500">{t(`tm.proc.hint.${s.key}`)}</span>
                      <span className={cn("mt-1 block text-xs font-medium", s.state === "done" ? "text-emerald-700" : s.state === "waiting" ? "text-slate-500" : "text-amber-800")}>
                        {s.state === "done" ? t("tm.proc.done") : s.state === "waiting" ? t("tm.proc.waiting") : s.key === "models" && !ov.counts.models ? t("tm.proc.noModels") : t(`tm.proc.todo.${s.key}`, { n: s.count })}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          {showData && <Readiness items={ov.readiness} onHide={() => setShowData(false)} />}
        </>
      )}
    </Card>
  );
}

function Readiness({ items, onHide }: { items: ReadinessItem[]; onHide: () => void }) {
  const t = useT();
  const icon = (s: ReadinessItem["status"]) => (s === "ok" ? <CheckCircle2 size={16} className="text-emerald-600" /> : s === "partial" ? <AlertTriangle size={16} className="text-amber-600" /> : <CircleDashed size={16} className="text-red-600" />);
  const sorted = [...items].sort((a, b) => ({ missing: 0, partial: 1, ok: 2 })[a.status] - ({ missing: 0, partial: 1, ok: 2 })[b.status]);
  return (
    <div className="border-t border-slate-100 px-5 py-3" data-testid="tm-readiness">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("tm.ready.title")}</span>
        <button type="button" className="text-xs text-brand-700 hover:underline" onClick={onHide}>
          {t("tm.ready.hide")}
        </button>
      </div>
      <p className="mb-2 text-sm text-slate-600">{t("tm.ready.hint")}</p>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {sorted.map((r) => (
          <li key={r.key} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
            {icon(r.status)}
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-slate-800">{t(`tm.ready.${r.key}`)}</span>
              <span className="block text-xs text-slate-500">
                {r.status === "ok" ? (r.total != null ? t("tm.ready.of", { v: r.value, n: r.total }) : t("tm.ready.ok")) : r.total ? `${t("tm.ready.of", { v: r.value, n: r.total })} – ${t(`tm.ready.missing.${r.key}`)}` : t(`tm.ready.missing.${r.key}`)} · {t("tm.ready.affects", { a: r.affects.map((a) => t(`tm.ready.area.${a}`)).join(", ") })}
              </span>
            </span>
            {r.status !== "ok" && (
              <Link to={r.path as never} className="inline-flex items-center gap-0.5 rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">
                {t("tm.ready.fix")} <ChevronRight size={14} />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Krátké „Jak na to“ u každé záložky (skrytí si pamatuje prohlížeč). */
function Guide({ id }: { id: "paths" | "calibration" | "landscape" | "models" }) {
  const t = useT();
  const [hidden, setHidden] = useStoredFlag(`contix.tm.guide.${id}`, false);
  if (hidden)
    return (
      <button type="button" className="mb-3 inline-flex items-center gap-1 text-xs text-brand-700 hover:underline" onClick={() => setHidden(false)}>
        <HelpCircle size={14} /> {t("tm.guide.show")}
      </button>
    );
  return (
    <div className="mb-4 rounded-lg border border-brand-100 bg-brand-50/60 px-4 py-3 text-sm text-slate-700" data-testid="tm-guide">
      <div className="mb-1.5 flex items-center gap-2">
        <Lightbulb size={16} className="text-brand-600" />
        <span className="flex-1 font-semibold text-slate-900">{t("tm.guide.title")}</span>
        <button type="button" className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700" onClick={() => setHidden(true)} aria-label={t("tm.guide.hide")} title={t("tm.guide.hide")}>
          <X size={14} />
        </button>
      </div>
      <ol className="list-decimal space-y-0.5 pl-5">
        {([1, 2, 3] as const).map((i) => (
          <li key={i}>{t(`tm.guide.${id}.${i}`)}</li>
        ))}
      </ol>
      <p className="mt-1.5 text-xs text-slate-500">{t(`tm.guide.${id}.terms`)}</p>
    </div>
  );
}

/* ---------------- útočné cesty ---------------- */

function Paths() {
  const t = useT();
  const [filter, setFilter] = useState<"open" | "decided" | "all">("open");
  const q = useQuery({ queryKey: ["modeling", "paths"], queryFn: api.modeling.paths });
  const d = q.data;
  if (!d) return <Card>{q.error ? <ErrorBox error={q.error} /> : <EmptyState>{t("common.loading")}</EmptyState>}</Card>;
  const open = d.paths.filter((p) => !p.decision);
  const shown = [...d.paths].filter((p) => (filter === "open" ? !p.decision : filter === "decided" ? !!p.decision : true)).sort((a, b) => Number(!!a.decision) - Number(!!b.decision) || pathPriority(b) - pathPriority(a));
  return (
    <div className="space-y-4" data-testid="tm-paths">
      <Facts
        items={[
          { label: t("tm.facts.entries"), value: d.entries },
          { label: t("tm.facts.targets"), value: d.targets },
          { label: t("tm.facts.paths"), value: d.paths.length },
          { label: t("tm.facts.open"), value: open.length, tone: open.length ? "amber" : undefined },
          { label: t("tm.facts.segmentation"), value: t.lbl(RISK_SCENARIO_LABELS.status[d.segmentation as keyof typeof RISK_SCENARIO_LABELS.status] ?? d.segmentation) },
        ]}
      />
      {d.lowConfidence && <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("tm.paths.lowConfidence")}</div>}
      {!d.paths.length ? (
        <Card>
          <EmptyState>{d.targets ? t("tm.paths.none") : t("tm.paths.noTargets")}</EmptyState>
        </Card>
      ) : (
        <>
          {d.chokepoints.length > 0 && (
            <Card>
              <CardHeader title={t("tm.choke.title")} subtitle={t("tm.choke.subtitle")} />
              <ul className="divide-y divide-slate-100">
                {d.chokepoints.map((c) => (
                  <li key={c.assetId} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
                    <span className="min-w-0 flex-1 font-medium text-slate-800">{c.assetId.startsWith("identity:") ? c.assetName : <Link to={`/assets/${c.assetId}` as never} className="hover:text-brand-700 hover:underline">{c.assetName}</Link>}</span>
                    <Badge tone="red">{t("tm.choke.paths", { n: c.paths })}</Badge>
                    <span className="w-full text-slate-600 md:w-auto">{c.fixes.map((f) => t.dyn(f, f)).join(" · ")}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("tm.filter")}>
            {(["open", "decided", "all"] as const).map((f) => {
              const n = f === "open" ? open.length : f === "decided" ? d.paths.length - open.length : d.paths.length;
              return (
                <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={cn("rounded-full px-3 py-1 text-xs font-medium", filter === f ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}>
                  {t(`tm.f.${f}`)} <span className="tabular-nums opacity-80">{n}</span>
                </button>
              );
            })}
          </div>
          {!shown.length ? (
            <Card>
              <EmptyState>{t("tm.paths.allDecided")}</EmptyState>
            </Card>
          ) : (
            shown.map((p, i) => <PathCard key={p.key} p={p} levels={d.levels} rank={i + 1} first={i === 0 && !p.decision} />)
          )}
        </>
      )}
    </div>
  );
}

function PathCard({ p, levels, rank, first }: { p: AttackPathDto; levels: number; rank: number; first: boolean }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const reason = useReason();
  const nav = useNavigate();
  const [accept, setAccept] = useState(false);
  const [why, setWhy] = useState("");
  const done = () => qc.invalidateQueries({ queryKey: ["modeling"] });
  const decide = useMutation({
    mutationFn: (v: Parameters<typeof api.modeling.decidePath>[1]) => api.modeling.decidePath(p.key, v),
    onSuccess: (r, v) => {
      done();
      setAccept(false);
      if (v.action === "risk" && r.riskId) {
        toast(t("tm.paths.riskCreated"));
        nav({ to: `/risks/${r.riskId}` as never });
      }
    },
    onError: (e) => toast((e as Error).message, "error"),
  });
  const prob = Math.round(p.probability * 100);
  return (
    <Card className="overflow-hidden" data-testid="tm-path">
      {first && (
        <div className="flex items-center gap-1.5 bg-brand-600 px-5 py-1 text-xs font-medium text-white">
          <Lightbulb size={13} /> {t("tm.startHere")}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
        <span className="text-xs font-semibold tabular-nums text-slate-400">#{rank}</span>
        <Badge tone={p.entry === "internet" ? "red" : "violet"}>
          <span className="inline-flex items-center gap-1">
            {p.entry === "internet" ? <Globe size={12} /> : <Mail size={12} />} {t(`tm.entry.${p.entry}`)}
          </span>
        </Badge>
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
          {p.steps[0]!.assetName} <ArrowRight size={14} className="inline text-slate-400" /> {p.targetName}
        </h3>
        <Badge tone={p.level >= levels ? "red" : p.level > levels / 2 ? "amber" : "slate"}>{t("tm.paths.level", { v: p.level, n: levels })}</Badge>
        <Badge tone="slate">{t("tm.paths.impact", { v: p.impact, n: levels })}</Badge>
        <span className="text-xs tabular-nums text-slate-500" title={t("tm.paths.probHint")}>
          {t("tm.paths.prob", { p: prob < 1 ? "<1" : prob })}
        </span>
      </div>
      <ol className="flex flex-wrap items-stretch gap-1.5 px-5 py-3" aria-label={t("tm.paths.steps")}>
        {p.steps.map((s, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight size={14} className="text-slate-300" aria-hidden />}
            <div className="rounded-md border border-slate-200 bg-white px-2 py-1" title={reason(s.reason)}>
              <div className="max-w-[14rem] truncate text-xs font-medium text-slate-800">{s.assetName}</div>
              <div className="text-[11px] text-slate-500">
                <span className="font-mono">{s.technique}</span> {techName(s.technique)} · {Math.round(s.ease * 100)} %
              </div>
            </div>
          </li>
        ))}
      </ol>
      <details className="px-5 pb-3 text-sm">
        <summary className="cursor-pointer text-brand-700">{t("tm.paths.why")}</summary>
        <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-slate-700">
          {p.steps.map((s, i) => (
            <li key={i}>
              <b>{s.assetName}</b> – {reason(s.reason)}
            </li>
          ))}
        </ol>
        {p.sector.actors.length > 0 && <p className="mt-2 text-slate-600">{t("tm.paths.actors", { a: p.sector.actors.join(", ") })}</p>}
      </details>
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-2.5">
        {p.decision ? (
          <>
            {p.decision.status === "risk" ? (
              <Badge tone="green">
                {t("tm.paths.inRegister")}{" "}
                {p.decision.riskId && (
                  <Link to={`/risks/${p.decision.riskId}` as never} className="underline">
                    {p.decision.riskName ?? t("tm.paths.risk")}
                  </Link>
                )}
              </Badge>
            ) : (
              <span className="text-sm text-slate-600">
                <Badge tone="slate">{t("tm.paths.accepted")}</Badge> {p.decision.reason}
              </span>
            )}
            <span className="text-xs text-slate-500">
              {p.decision.byName} · {fmtDay(p.decision.at)}
            </span>
            {can("risks:write") && p.decision.status === "accepted" && (
              <Button variant="ghost" className="ml-auto px-2 py-1 text-xs" onClick={() => decide.mutate({ action: "reopen" })}>
                <Undo2 size={14} /> {t("tm.paths.reopen")}
              </Button>
            )}
          </>
        ) : (
          can("risks:write") && (
            <>
              <Button
                className="px-2.5 py-1 text-xs"
                disabled={decide.isPending}
                onClick={async () => {
                  if (await askConfirm(t("tm.paths.riskConfirm"), { confirmLabel: t("tm.paths.createRisk") })) decide.mutate({ action: "risk" });
                }}
              >
                <ShieldAlert size={14} /> {t("tm.paths.createRisk")}
              </Button>
              <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setAccept(true)}>
                <Check size={14} /> {t("tm.paths.accept")}
              </Button>
            </>
          )
        )}
      </div>
      {accept && (
        <Modal
          open
          onClose={() => setAccept(false)}
          title={t("tm.paths.acceptTitle")}
          footer={
            <Button disabled={why.trim().length < 5 || decide.isPending} onClick={() => decide.mutate({ action: "accept", reason: why.trim() })}>
              <Check size={16} /> {t("tm.paths.accept")}
            </Button>
          }
        >
          <p className="mb-3 text-sm text-slate-600">{t("tm.paths.acceptHint")}</p>
          <Field label={t("tm.reason")}>
            <Textarea rows={3} value={why} onChange={(e) => setWhy(e.target.value)} autoFocus />
          </Field>
        </Modal>
      )}
    </Card>
  );
}

/* ---------------- kalibrace ---------------- */

function Calibration() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const reason = useReason();
  const [onlyDrift, setOnlyDrift] = useState(true);
  const q = useQuery({ queryKey: ["modeling", "calibration"], queryFn: api.modeling.calibration });
  const apply = useMutation({
    mutationFn: (c: CalibrationDto) => api.modeling.applyCalibration(c.riskId, { impact: c.proposed.impact, threatLevel: c.proposed.threatLevel, vulnLevel: c.proposed.vulnLevel, likelihood: c.proposed.likelihood }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["modeling", "calibration"] });
      qc.invalidateQueries({ queryKey: ["modeling", "overview"] });
      qc.invalidateQueries({ queryKey: ["risks"] });
      toast(t("tm.cal.applied"));
    },
    onError: (e) => toast((e as Error).message, "error"),
  });
  const list = useMemo(
    () => (q.data ?? []).filter((c) => !onlyDrift || c.drift.impact == null || c.drift.likelihood == null || c.drift.impact !== 0 || c.drift.likelihood !== 0).sort((a, b) => Number(a.outdated) - Number(b.outdated) || calibrationPriority(b) - calibrationPriority(a)),
    [q.data, onlyDrift],
  );
  const diff = (v: number | null) => (v == null ? <Badge tone="amber">{t("tm.cal.unrated")}</Badge> : v === 0 ? <span className="text-slate-400">0</span> : <span className={cn("font-semibold", v > 0 ? "text-red-700" : "text-emerald-700")}>{v > 0 ? `+${v}` : v}</span>);
  return (
    <div className="space-y-4" data-testid="tm-calibration">
      <Card>
        <CardHeader title={t("tm.cal.title")} subtitle={t("tm.cal.subtitle")} action={<Checkbox checked={onlyDrift} onChange={setOnlyDrift} label={t("tm.cal.onlyDrift")} />} />
        <ErrorBox error={q.error} />
        {!list.length ? (
          <EmptyState>{q.isLoading ? t("common.loading") : t("tm.cal.none")}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2">{t("tm.cal.risk")}</th>
                  <th className="px-3 py-2">{t("tm.cal.current")}</th>
                  <th className="px-3 py-2">{t("tm.cal.proposed")}</th>
                  <th className="px-3 py-2">{t("tm.cal.diff")}</th>
                  <th className="px-3 py-2">{t("tm.cal.confidence")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((c, i) => (
                  <tr key={c.riskId} className={cn("align-top", i === 0 && !c.outdated && "bg-brand-50/50")}>
                    <td className="px-5 py-2.5">
                      {i === 0 && !c.outdated && (
                        <div className="mb-1 inline-flex items-center gap-1 rounded bg-brand-600 px-1.5 py-0.5 text-[11px] font-medium text-white">
                          <Lightbulb size={12} /> {t("tm.startHere")}
                        </div>
                      )}
                      <Link to={`/risks/${c.riskId}` as never} className="font-medium text-slate-800 hover:text-brand-700 hover:underline">
                        {c.riskCode ? `${c.riskCode} ` : ""}
                        {c.riskName}
                      </Link>
                      <details className="mt-1 text-xs text-slate-600">
                        <summary className="cursor-pointer text-brand-700">{t("tm.cal.why", { n: c.proposed.sources })}</summary>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4">
                          {c.proposed.reasons.map((r, i) => (
                            <li key={i}>
                              <span className="text-slate-400">{t(`tm.cal.kind.${r.kind}`)}:</span> {reason(r)}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{t("tm.cal.dp", { d: c.current.impact ?? "–", p: c.current.likelihood ?? "–" })}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-semibold tabular-nums">
                      {t("tm.cal.dp", { d: c.proposed.impact, p: c.proposed.likelihood })}
                      {c.method === "three_factor" && <div className="text-xs font-normal text-slate-500">{t("tm.cal.hz", { h: c.proposed.threatLevel, z: c.proposed.vulnLevel })}</div>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                      {diff(c.drift.impact)} / {diff(c.drift.likelihood)}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={c.proposed.confidence === "high" ? "green" : c.proposed.confidence === "medium" ? "blue" : "slate"}>{t(`tm.cal.conf.${c.proposed.confidence}`)}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {can("risks:write") && !c.outdated && (
                        <Button
                          variant="secondary"
                          className="px-2.5 py-1 text-xs"
                          disabled={apply.isPending}
                          onClick={async () => {
                            if (await askConfirm(t("tm.cal.applyConfirm", { name: c.riskName }), { confirmLabel: t("tm.cal.apply") })) apply.mutate(c);
                          }}
                        >
                          {t("tm.cal.apply")}
                        </Button>
                      )}
                      {c.outdated && <span className="text-xs text-slate-500">{t("tm.cal.outdated")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------------- aktéři pro odvětví ---------------- */

function Landscape() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["modeling", "landscape"], queryFn: api.modeling.landscape });
  const [ov, setOv] = useState<{ a: ActorRelevanceDto; relevant: boolean } | null>(null);
  const [why, setWhy] = useState("");
  const save = useMutation({
    mutationFn: api.modeling.saveProfile,
    onSuccess: (d) => {
      qc.setQueryData(["modeling", "landscape"], d);
      qc.invalidateQueries({ queryKey: ["modeling", "calibration"] });
      qc.invalidateQueries({ queryKey: ["modeling", "paths"] });
      qc.invalidateQueries({ queryKey: ["modeling", "overview"] });
      setOv(null);
      setWhy("");
      toast(t("tm.land.saved"));
    },
    onError: (e) => toast((e as Error).message, "error"),
  });
  const d = q.data;
  if (!d) return <Card>{q.error ? <ErrorBox error={q.error} /> : <EmptyState>{t("common.loading")}</EmptyState>}</Card>;
  const overrides = Object.fromEntries(d.actors.filter((a) => a.override).map((a) => [a.key, a.override!]));
  const put = (sector: Sector | null, o: Record<string, { relevant: boolean; reason: string }>) => save.mutate({ sector, overrides: o });
  const tplChanged = d.templates.filter((x) => x.delta !== 0);
  return (
    <div className="space-y-4" data-testid="tm-landscape">
      <Card className="p-5">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("tm.land.sector")} className="min-w-64">
            <Select value={d.sector ?? ""} disabled={!can("risks:write") || save.isPending} onChange={(e) => put((e.target.value || null) as Sector | null, overrides)} aria-label={t("tm.land.sector")}>
              <option value="">{t("tm.land.noSector")}</option>
              {SECTORS.map((s) => (
                <option key={s} value={s}>
                  {t.lbl(SECTOR_LABELS[s])}
                </option>
              ))}
            </Select>
          </Field>
          <p className="min-w-0 flex-1 text-sm text-slate-600">{t("tm.land.hint")}</p>
        </div>
        {d.updatedAt && <p className="mt-2 text-xs text-slate-500">{t("tm.land.updated", { by: d.updatedByName ?? "–", at: fmtDay(d.updatedAt) })}</p>}
      </Card>
      <Card>
        <CardHeader title={t("tm.land.actors")} subtitle={t("tm.land.actorsHint")} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2">{t("tm.land.actor")}</th>
                <th className="px-3 py-2">{t("tm.land.relevance")}</th>
                <th className="px-3 py-2">{t("tm.land.signals")}</th>
                <th className="px-3 py-2">ATT&amp;CK</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {d.actors.map((a) => (
                <tr key={a.key} className="align-top" data-testid={`actor-${a.key}`}>
                  <td className="px-5 py-2.5">
                    <div className="font-medium text-slate-800">{t.lbl(a.name)}</div>
                    <div className="text-xs text-slate-500">
                      {t.lbl(TM_LABELS.motivation[a.motivation])} · {t.lbl(a.origin)} · {t(`tm.land.match.${a.sectorMatch}`)}
                    </div>
                    {a.override && <div className="mt-1 text-xs text-slate-600">{t(a.override.relevant ? "tm.land.markedRelevant" : "tm.land.markedNot", { r: a.override.reason })}</div>}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={relTone[a.relevance]}>{t.lbl(TM_LABELS.relevance[a.relevance])}</Badge>
                    <div className="mt-0.5 text-xs tabular-nums text-slate-500">{t("tm.land.score", { n: a.score })}</div>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">
                    {a.signals.mentions.length > 0 && (
                      <details>
                        <summary className="cursor-pointer text-brand-700">{t("tm.land.mentions", { n: a.signals.mentions.length })}</summary>
                        <ul className="mt-1 space-y-0.5">
                          {a.signals.mentions.map((m, i) => (
                            <li key={i}>
                              {m.link ? (
                                <a href={m.link} target="_blank" rel="noreferrer" className="hover:underline">
                                  {m.title}
                                </a>
                              ) : (
                                m.title
                              )}{" "}
                              <span className="text-slate-400">{m.at ? fmtDay(m.at) : ""}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {a.signals.intel > 0 && <div>{t("tm.land.intel", { n: a.signals.intel })}</div>}
                    {a.signals.alerts > 0 && <div>{t("tm.land.alerts", { n: a.signals.alerts })}</div>}
                    {!a.signals.mentions.length && !a.signals.intel && !a.signals.alerts && <span className="text-slate-400">–</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex max-w-xs flex-wrap gap-1">
                      {a.techniques.map((x) => (
                        <span key={x} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700" title={techName(x)}>
                          {x}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">
                    {can("risks:write") &&
                      (a.override ? (
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-xs"
                          onClick={() => {
                            const o = { ...overrides };
                            delete o[a.key];
                            put(d.sector, o);
                          }}
                        >
                          <Undo2 size={14} /> {t("tm.land.clear")}
                        </Button>
                      ) : (
                        <>
                          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setOv({ a, relevant: true })}>
                            {t("tm.land.relevant")}
                          </Button>
                          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setOv({ a, relevant: false })}>
                            {t("tm.land.notRelevant")}
                          </Button>
                        </>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("tm.land.templates")} subtitle={t("tm.land.templatesHint")} />
          {!tplChanged.length ? (
            <EmptyState>{t("tm.land.noChange")}</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {tplChanged.map((x) => (
                <li key={x.key} className="flex items-center gap-3 px-5 py-2">
                  <span className="min-w-0 flex-1">{t.lbl(RISK_SCENARIO_LABELS.template[x.key as keyof typeof RISK_SCENARIO_LABELS.template] ?? x.key)}</span>
                  <Badge tone={x.delta > 0 ? "red" : "green"}>{x.delta > 0 ? t("tm.land.up") : t("tm.land.down")}</Badge>
                  <span className="hidden text-xs text-slate-500 md:inline">{x.actors.map((n) => t.lbl(n)).join(", ")}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title={t("tm.land.techniques")} subtitle={t("tm.land.techniquesHint")} />
          {!d.techniques.length ? (
            <EmptyState>{t("tm.land.noRelevant")}</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {d.techniques.slice(0, 20).map((x) => (
                <li key={x.id} className="flex items-center gap-3 px-5 py-2">
                  <span className="font-mono text-xs">{x.id}</span>
                  <span className="min-w-0 flex-1 truncate">{techName(x.id)}</span>
                  <span className="hidden text-xs text-slate-500 md:inline">{x.actors.length}×</span>
                  <Badge tone={x.detection === "blind" ? "red" : x.detection === "covered" ? "green" : x.detection === "partial" ? "blue" : "slate"}>{t(`tm.det.${x.detection}`)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {ov && (
        <Modal
          open
          onClose={() => setOv(null)}
          title={t(ov.relevant ? "tm.land.relevantTitle" : "tm.land.notRelevantTitle", { a: t.lbl(ov.a.name) })}
          footer={
            <Button disabled={why.trim().length < 3 || save.isPending} onClick={() => put(d.sector, { ...overrides, [ov.a.key]: { relevant: ov.relevant, reason: why.trim() } })}>
              <Check size={16} /> {t("tm.save")}
            </Button>
          }
        >
          <Field label={t("tm.reason")}>
            <Textarea rows={3} value={why} onChange={(e) => setWhy(e.target.value)} autoFocus />
          </Field>
        </Modal>
      )}
    </div>
  );
}

/* ---------------- threat modely ---------------- */

function Models() {
  const t = useT();
  const can = useCan();
  const q = useQuery({ queryKey: ["modeling", "models"], queryFn: api.modeling.models });
  const [create, setCreate] = useState(false);
  return (
    <div className="space-y-4" data-testid="tm-models">
      <Card>
        <CardHeader
          title={t("tm.models.title")}
          subtitle={t("tm.models.subtitle")}
          action={
            can("risks:write") && (
              <Button onClick={() => setCreate(true)}>
                <Plus size={16} /> {t("tm.models.new")}
              </Button>
            )
          }
        />
        <ErrorBox error={q.error} />
        {!q.data?.length ? (
          <EmptyState>{q.isLoading ? t("common.loading") : t("tm.models.none")}</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {q.data.map((m) => (
              <li key={m.id}>
                <Link to={`/risks/modeling/models/${m.id}` as never} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-slate-50">
                  <Route size={16} className="text-slate-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800">{m.name}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {t.lbl(TM_LABELS.scope[m.scope])}
                      {m.scopeName ? ` · ${m.scopeName}` : ""} · {fmtDay(m.updatedAt)}
                    </span>
                  </span>
                  <Badge tone={m.status === "done" ? "green" : m.status === "review" ? "blue" : "slate"}>{t.lbl(TM_LABELS.status[m.status])}</Badge>
                  <span className="text-xs tabular-nums text-slate-600">{t("tm.models.sum", { n: m.summary.threats, h: m.summary.high, o: m.summary.open })}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {create && <NewModel onClose={() => setCreate(false)} />}
    </div>
  );
}

function NewModel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<TmScope>("application");
  const [asset, setAsset] = useState<PickedAsset[]>([]);
  const [scopeId, setScopeId] = useState("");
  const [seedFromGraph, setSeed] = useState(true);
  const procs = useQuery({ queryKey: ["processes", "tm"], queryFn: () => api.processes.list({}), enabled: scope === "process" });
  const projs = useQuery({ queryKey: ["projects", "tm"], queryFn: () => api.projects.list(), enabled: scope === "project" });
  const usesAsset = scope === "application" || scope === "asset";
  const sid = usesAsset ? (asset[0]?.id ?? null) : scopeId || null;
  const make = useMutation({
    mutationFn: async () => {
      const seed = usesAsset && sid && seedFromGraph ? await api.modeling.seed(sid) : null;
      return api.modeling.createModel({ name: name.trim() || asset[0]?.name || t("tm.models.untitled"), scope, scopeId: sid, elements: seed?.elements ?? [] });
    },
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ["modeling", "models"] });
      nav({ to: `/risks/modeling/models/${m.id}` as never });
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("tm.models.new")}
      footer={
        <Button disabled={make.isPending || (!name.trim() && !asset.length)} onClick={() => make.mutate()}>
          <Plus size={16} /> {t("tm.models.create")}
        </Button>
      }
    >
      <ErrorBox error={make.error} />
      <div className="space-y-3">
        <Field label={t("tm.models.name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label={t("tm.models.scope")}>
          <Select value={scope} onChange={(e) => (setScope(e.target.value as TmScope), setScopeId(""))}>
            {TM_SCOPES.map((s) => (
              <option key={s} value={s}>
                {t.lbl(TM_LABELS.scope[s])}
              </option>
            ))}
          </Select>
        </Field>
        {usesAsset && (
          <>
            <Field label={t("tm.models.asset")}>
              <AssetPicker value={asset} onChange={(v) => setAsset(v.slice(-1))} />
            </Field>
            {asset.length > 0 && <Checkbox checked={seedFromGraph} onChange={setSeed} label={t("tm.models.seed")} hint={t("tm.models.seedHint")} />}
          </>
        )}
        {scope === "process" && (
          <Field label={t("tm.models.process")}>
            <Select value={scopeId} onChange={(e) => setScopeId(e.target.value)}>
              <option value="">–</option>
              {(procs.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {scope === "project" && (
          <Field label={t("tm.models.project")}>
            <Select value={scopeId} onChange={(e) => setScopeId(e.target.value)}>
              <option value="">–</option>
              {(projs.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </Modal>
  );
}

/* ---------------- průvodce threat modelem ---------------- */

const STEPS = ["scope", "elements", "threats", "outputs"] as const;
type Step = (typeof STEPS)[number];

export function ThreatModelPage() {
  const t = useT();
  const riskNav = useRiskNav();
  const { modelId } = useParams({ strict: false }) as { modelId: string };
  const q = useQuery({ queryKey: ["modeling", "model", modelId], queryFn: () => api.modeling.model(modelId) });
  const [step, setStep] = useTab(STEPS, "elements");
  const m = q.data;
  if (!m) return <Card>{q.error ? <ErrorBox error={q.error} /> : <EmptyState>{t("common.loading")}</EmptyState>}</Card>;
  return (
    <>
      <PageHeader
        nav={riskNav}
        title={m.name}
        subtitle={`${t.lbl(TM_LABELS.scope[m.scope])}${m.scopeName ? ` · ${m.scopeName}` : ""}`}
        badge={<Badge tone={m.status === "done" ? "green" : m.status === "review" ? "blue" : "slate"}>{t.lbl(TM_LABELS.status[m.status])}</Badge>}
        facts={[
          { label: t("tm.sum.elements"), value: m.elements.filter((e) => e.kind !== "flow").length },
          { label: t("tm.sum.flows"), value: m.elements.filter((e) => e.kind === "flow").length },
          { label: t("tm.sum.threats"), value: m.summary.threats },
          { label: t("tm.sum.high"), value: m.summary.high, tone: m.summary.high ? "red" : undefined },
          { label: t("tm.sum.open"), value: m.summary.open, tone: m.summary.open ? "amber" : undefined },
          { label: t("tm.sum.requirements"), value: m.summary.requirements },
          { label: t("tm.sum.risks"), value: m.summary.risks },
        ]}
      />
      <ol className="mb-4 flex flex-wrap gap-2" aria-label={t("tm.wizard")}>
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              aria-current={step === s ? "step" : undefined}
              onClick={() => setStep(s)}
              className={cn("flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm", step === s ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50")}
            >
              <span className={cn("grid h-5 w-5 place-items-center rounded-full text-xs font-semibold", step === s ? "bg-white/20" : "bg-slate-100")}>{i + 1}</span>
              {t(`tm.step.${s}`)}
            </button>
          </li>
        ))}
      </ol>
      {step === "scope" ? <ScopeStep m={m} /> : step === "elements" ? <ElementsStep m={m} onNext={() => setStep("threats")} /> : step === "threats" ? <ThreatsStep m={m} /> : <OutputsStep m={m} />}
    </>
  );
}

function useSaveModel(id: string) {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: (data: Parameters<typeof api.modeling.updateModel>[1]) => api.modeling.updateModel(id, data),
    onSuccess: (m) => {
      qc.setQueryData(["modeling", "model", id], m);
      qc.invalidateQueries({ queryKey: ["modeling", "models"] });
      qc.invalidateQueries({ queryKey: ["modeling", "overview"] });
      toast(t("tm.saved"));
    },
    onError: (e) => toast((e as Error).message, "error"),
  });
}

function ScopeStep({ m }: { m: ThreatModelDto }) {
  const t = useT();
  const can = useCan();
  const nav = useNavigate();
  const save = useSaveModel(m.id);
  const [name, setName] = useState(m.name);
  const [desc, setDesc] = useState(m.description ?? "");
  const [status, setStatus] = useState(m.status);
  const remove = useMutation({ mutationFn: () => api.modeling.deleteModel(m.id), onSuccess: () => nav({ to: "/risks/modeling", search: { tab: "models" } as never }) });
  return (
    <Card className="space-y-3 p-5">
      <Field label={t("tm.models.name")}>
        <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!can("risks:write")} />
      </Field>
      <Field label={t("tm.models.description")} hint={t("tm.models.descriptionHint")}>
        <Textarea rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} disabled={!can("risks:write")} />
      </Field>
      <Field label={t("tm.models.status")}>
        <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} disabled={!can("risks:write")}>
          {TM_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.lbl(TM_LABELS.status[s])}
            </option>
          ))}
        </Select>
      </Field>
      {can("risks:write") && (
        <div className="flex flex-wrap gap-2">
          <Button disabled={save.isPending || !name.trim()} onClick={() => save.mutate({ name: name.trim(), description: desc.trim() || null, status })}>
            <Check size={16} /> {t("tm.save")}
          </Button>
          <Button
            variant="ghost"
            className="ml-auto text-red-700"
            onClick={async () => {
              if (await askConfirm(t("tm.models.deleteConfirm", { name: m.name }), { danger: true })) remove.mutate();
            }}
          >
            <Trash2 size={16} /> {t("common.delete")}
          </Button>
        </div>
      )}
    </Card>
  );
}

let seq = 0;
const newId = (kind: TmElementKind, list: TmElement[]) => {
  const p = { external: "e", process: "p", store: "s", flow: "f" }[kind];
  let i = list.length + 1 + seq++;
  while (list.some((e) => e.id === `${p}${i}`)) i++;
  return `${p}${i}`;
};

function ElementsStep({ m, onNext }: { m: ThreatModelDto; onNext: () => void }) {
  const t = useT();
  const can = useCan();
  const save = useSaveModel(m.id);
  const [els, setEls] = useState<TmElement[]>(m.elements);
  useEffect(() => setEls(m.elements), [m.elements]);
  const dirty = JSON.stringify(els) !== JSON.stringify(m.elements);
  const ro = !can("risks:write");
  const nodes = els.filter((e) => e.kind !== "flow");
  const set = (id: string, patch: Partial<TmElement>) => setEls(els.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const add = (kind: TmElementKind) => {
    const base: TmElement = { id: newId(kind, els), kind, name: t(`tm.new.${kind}`), zone: "internal", data: "internal", auth: "unknown", encrypted: null, logging: null, assetId: null, from: kind === "flow" ? (nodes[0]?.id ?? null) : null, to: kind === "flow" ? (nodes[1]?.id ?? null) : null, note: null };
    setEls([...els, base]);
  };
  const byId = new Map(els.map((e) => [e.id, e]));
  const zones = TM_ZONES.filter((z) => nodes.some((n) => n.zone === z)).sort((a, b) => ZONE_TRUST[a] - ZONE_TRUST[b]);
  const tri = (v: boolean | null) => (v == null ? "" : v ? "1" : "0");
  const fromTri = (v: string) => (v === "" ? null : v === "1");
  return (
    <div className="space-y-4">
      {zones.length > 0 && (
        <Card className="p-5" data-testid="tm-diagram">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("tm.el.diagram")}</div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {zones.map((z) => (
              <div key={z} className="min-w-[11rem] flex-1 rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-2">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t.lbl(TM_LABELS.zone[z])}</div>
                <div className="space-y-1.5">
                  {nodes
                    .filter((n) => n.zone === z)
                    .map((n) => (
                      <div key={n.id} className={cn("border bg-white px-2 py-1 text-xs", n.kind === "external" ? "rounded-none border-slate-400" : n.kind === "store" ? "rounded-sm border-x-0 border-y-2 border-slate-400" : "rounded-full border-brand-300")}>
                        <span className="font-mono text-[10px] text-slate-400">{n.id}</span> {n.name}
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
          {els.some((e) => e.kind === "flow") && (
            <ul className="mt-3 flex flex-wrap gap-1.5 text-xs">
              {els
                .filter((e) => e.kind === "flow")
                .map((f) => {
                  const a = byId.get(f.from ?? "");
                  const b = byId.get(f.to ?? "");
                  const cross = a && b && a.zone !== b.zone;
                  return (
                    <li key={f.id} className={cn("rounded-full border px-2 py-0.5", cross ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 bg-white text-slate-700")} title={cross ? t("tm.el.crossing") : undefined}>
                      {a?.name ?? "?"} → {b?.name ?? "?"} <span className="text-slate-400">({f.name})</span>
                    </li>
                  );
                })}
            </ul>
          )}
        </Card>
      )}
      <Card>
        <CardHeader
          title={t("tm.el.title")}
          subtitle={t("tm.el.subtitle")}
          action={
            !ro && (
              <div className="flex flex-wrap gap-1.5">
                {TM_ELEMENT_KINDS.map((k) => (
                  <Button key={k} variant="secondary" className="px-2 py-1 text-xs" onClick={() => add(k)} disabled={k === "flow" && nodes.length < 2}>
                    <Plus size={14} /> {t.lbl(TM_LABELS.kind[k])}
                  </Button>
                ))}
              </div>
            )
          }
        />
        {!els.length ? (
          <EmptyState>{t("tm.el.none")}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">{t("tm.el.name")}</th>
                  <th className="px-2 py-2">{t("tm.el.kind")}</th>
                  <th className="px-2 py-2">{t("tm.el.zoneOrFlow")}</th>
                  <th className="px-2 py-2">{t("tm.el.data")}</th>
                  <th className="px-2 py-2">{t("tm.el.auth")}</th>
                  <th className="px-2 py-2">{t("tm.el.encrypted")}</th>
                  <th className="px-2 py-2">{t("tm.el.logging")}</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {els.map((e) => (
                  <tr key={e.id}>
                    <td className="px-3 py-1.5">
                      <Input className="min-w-40 py-1" value={e.name} disabled={ro} onChange={(x) => set(e.id, { name: x.target.value })} aria-label={t("tm.el.name")} />
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs text-slate-600">
                      <span className="font-mono text-slate-400">{e.id}</span> {t.lbl(TM_LABELS.kind[e.kind])}
                    </td>
                    <td className="px-2 py-1.5">
                      {e.kind === "flow" ? (
                        <div className="flex items-center gap-1">
                          <Select className="py-1" value={e.from ?? ""} disabled={ro} onChange={(x) => set(e.id, { from: x.target.value })} aria-label={t("tm.el.from")}>
                            {nodes.map((n) => (
                              <option key={n.id} value={n.id}>
                                {n.name}
                              </option>
                            ))}
                          </Select>
                          <ArrowRight size={14} className="shrink-0 text-slate-400" />
                          <Select className="py-1" value={e.to ?? ""} disabled={ro} onChange={(x) => set(e.id, { to: x.target.value })} aria-label={t("tm.el.to")}>
                            {nodes.map((n) => (
                              <option key={n.id} value={n.id}>
                                {n.name}
                              </option>
                            ))}
                          </Select>
                        </div>
                      ) : (
                        <Select className="py-1" value={e.zone} disabled={ro} onChange={(x) => set(e.id, { zone: x.target.value as TmElement["zone"] })} aria-label={t("tm.el.zone")}>
                          {TM_ZONES.map((z) => (
                            <option key={z} value={z}>
                              {t.lbl(TM_LABELS.zone[z])}
                            </option>
                          ))}
                        </Select>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <Select className="py-1" value={e.data} disabled={ro} onChange={(x) => set(e.id, { data: x.target.value as TmElement["data"] })} aria-label={t("tm.el.data")}>
                        {TM_DATA.map((z) => (
                          <option key={z} value={z}>
                            {t.lbl(TM_LABELS.data[z])}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-2 py-1.5">
                      <Select className="py-1" value={e.auth} disabled={ro} onChange={(x) => set(e.id, { auth: x.target.value as TmElement["auth"] })} aria-label={t("tm.el.auth")}>
                        {TM_AUTH.map((z) => (
                          <option key={z} value={z}>
                            {t.lbl(TM_LABELS.auth[z])}
                          </option>
                        ))}
                      </Select>
                    </td>
                    {(["encrypted", "logging"] as const).map((k) => (
                      <td key={k} className="px-2 py-1.5">
                        <Select className="py-1" value={tri(e[k])} disabled={ro} onChange={(x) => set(e.id, { [k]: fromTri(x.target.value) })} aria-label={t(`tm.el.${k}`)}>
                          <option value="">?</option>
                          <option value="1">{t("common.yes")}</option>
                          <option value="0">{t("common.no")}</option>
                        </Select>
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-right">
                      {!ro && (
                        <button type="button" className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700" aria-label={`${t("common.delete")}: ${e.name}`} onClick={() => setEls(els.filter((x) => x.id !== e.id && x.from !== e.id && x.to !== e.id))}>
                          <Trash2 size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!ro && (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-3">
            <Button disabled={!dirty || save.isPending} onClick={() => save.mutate({ elements: els })}>
              <Check size={16} /> {t("tm.el.save")}
            </Button>
            {dirty && <span className="text-xs text-amber-700">{t("tm.unsaved")}</span>}
            <Button variant="ghost" className="ml-auto" disabled={dirty} onClick={onNext}>
              {t("tm.el.next")} <ChevronRight size={16} />
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

function ThreatsStep({ m }: { m: ThreatModelDto }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const save = useSaveModel(m.id);
  const [list, setList] = useState<TmThreat[]>(m.threats);
  useEffect(() => setList(m.threats), [m.threats]);
  const [stride, setStride] = useState<Stride | "">("");
  const [status, setStatus] = useState<TmThreatStatus | "">("");
  const dirty = JSON.stringify(list) !== JSON.stringify(m.threats);
  const ro = !can("risks:write");
  const el = new Map(m.elements.map((e) => [e.id, e]));
  const set = (key: string, patch: Partial<TmThreat>) => setList(list.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const toRisk = useMutation({
    mutationFn: (key: string) => api.modeling.threatRisk(m.id, key),
    onSuccess: (r) => {
      qc.setQueryData(["modeling", "model", m.id], r.model);
      qc.invalidateQueries({ queryKey: ["risks"] });
      toast(t("tm.th.riskCreated"));
    },
    onError: (e) => toast((e as Error).message, "error"),
  });
  const shown = list.filter((x) => (!stride || x.stride === stride) && (!status || x.status === status));
  return (
    <Card data-testid="tm-threats">
      <CardHeader title={t("tm.th.title")} subtitle={t("tm.th.subtitle")} />
      <div className="flex flex-wrap gap-2 px-5 pb-3">
        <Select className="w-auto py-1" value={stride} onChange={(e) => setStride(e.target.value as Stride | "")} aria-label="STRIDE">
          <option value="">{t("tm.th.allStride")}</option>
          {STRIDE.map((s) => (
            <option key={s} value={s}>
              {t.lbl(TM_LABELS.stride[s])}
            </option>
          ))}
        </Select>
        <Select className="w-auto py-1" value={status} onChange={(e) => setStatus(e.target.value as TmThreatStatus | "")} aria-label={t("tm.th.status")}>
          <option value="">{t("tm.th.allStatus")}</option>
          {TM_THREAT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.lbl(TM_LABELS.threatStatus[s])}
            </option>
          ))}
        </Select>
      </div>
      {!shown.length ? (
        <EmptyState>{m.elements.length ? t("tm.th.none") : t("tm.th.noElements")}</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {shown.map((x) => (
            <li key={x.key} className="space-y-2 px-5 py-3" data-testid={`threat-${x.key}`}>
              <div className="flex flex-wrap items-start gap-2">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-slate-800 text-xs font-bold text-white" title={t.lbl(TM_LABELS.stride[x.stride])}>
                  {x.stride}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-900">{x.title}</div>
                  <div className="text-xs text-slate-500">
                    {el.get(x.elementId)?.name ?? x.elementId} · {x.attack.map((a) => `${a}${techName(a) ? ` ${techName(a)}` : ""}`).join(", ")}
                  </div>
                </div>
                <Badge tone={sevTone(x.severity)}>{t(`tm.sev.${x.severity as 1 | 2 | 3 | 4}`)}</Badge>
                <Badge tone={tStatusTone[x.status]}>{t.lbl(TM_LABELS.threatStatus[x.status])}</Badge>
              </div>
              <div className="grid gap-2 md:grid-cols-[14rem_1fr_auto]">
                <Select className="py-1" value={x.status} disabled={ro || !!x.riskId} onChange={(e) => set(x.key, { status: e.target.value as TmThreatStatus })} aria-label={`${t("tm.th.status")}: ${x.title}`}>
                  {TM_THREAT_STATUSES.filter((s) => s !== "risk" || x.riskId).map((s) => (
                    <option key={s} value={s}>
                      {t.lbl(TM_LABELS.threatStatus[s])}
                    </option>
                  ))}
                </Select>
                {x.status === "mitigate" ? (
                  <Textarea rows={2} value={x.requirement} disabled={ro} onChange={(e) => set(x.key, { requirement: e.target.value })} aria-label={t("tm.th.requirement")} />
                ) : (
                  <Input className="py-1" placeholder={t("tm.th.note")} value={x.note ?? ""} disabled={ro} onChange={(e) => set(x.key, { note: e.target.value || null })} aria-label={t("tm.th.note")} />
                )}
                {x.riskId ? (
                  <Link to={`/risks/${x.riskId}` as never} className="self-center text-sm text-brand-700 hover:underline">
                    {t("tm.th.openRisk")}
                  </Link>
                ) : (
                  !ro && (
                    <Button
                      variant="secondary"
                      className="px-2.5 py-1 text-xs"
                      disabled={toRisk.isPending || dirty}
                      title={dirty ? t("tm.th.saveFirst") : undefined}
                      onClick={async () => {
                        if (await askConfirm(t("tm.th.riskConfirm"), { confirmLabel: t("tm.th.toRisk") })) toRisk.mutate(x.key);
                      }}
                    >
                      <ShieldAlert size={14} /> {t("tm.th.toRisk")}
                    </Button>
                  )
                )}
              </div>
              {x.status !== "mitigate" && <p className="text-xs text-slate-500">{t("tm.th.suggested", { r: x.requirement })}</p>}
            </li>
          ))}
        </ul>
      )}
      {!ro && (
        <div className="sticky bottom-0 flex items-center gap-2 border-t border-slate-100 bg-white/95 px-5 py-3">
          <Button disabled={!dirty || save.isPending} onClick={() => save.mutate({ threats: list })}>
            <Check size={16} /> {t("tm.th.save")}
          </Button>
          {dirty && <span className="text-xs text-amber-700">{t("tm.unsaved")}</span>}
        </div>
      )}
    </Card>
  );
}

function OutputsStep({ m }: { m: ThreatModelDto }) {
  const t = useT();
  const req = m.threats.filter((x) => x.status === "mitigate");
  const risks = m.threats.filter((x) => x.riskId);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          title={t("tm.out.requirements")}
          subtitle={t("tm.out.requirementsHint")}
          action={
            <div className="flex gap-1.5">
              <a href={api.modeling.reportUrl(m.id, "docx")} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                <Download size={14} /> Word
              </a>
              <a href={api.modeling.reportUrl(m.id, "html")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                <FileText size={14} /> {t("tm.out.print")}
              </a>
            </div>
          }
        />
        {!req.length ? (
          <EmptyState>{t("tm.out.noRequirements")}</EmptyState>
        ) : (
          <ol className="list-decimal space-y-2 px-5 pb-4 pl-10 text-sm text-slate-800">
            {req.map((x) => (
              <li key={x.key}>
                {x.requirement}
                <div className="text-xs text-slate-500">{x.title}</div>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <Card>
        <CardHeader title={t("tm.out.risks")} subtitle={t("tm.out.risksHint")} />
        {!risks.length ? (
          <EmptyState>{t("tm.out.noRisks")}</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {risks.map((x) => (
              <li key={x.key} className="px-5 py-2">
                <Link to={`/risks/${x.riskId}` as never} className="text-brand-700 hover:underline">
                  {x.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
