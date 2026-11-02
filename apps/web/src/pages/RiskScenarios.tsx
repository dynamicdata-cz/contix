import { Tabs, useTab } from "@/components/ui/tabs";
import { askConfirm, toast } from "@/components/ui/overlay";
import { CompanyCell, useGroupView } from "@/components/company";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, SuccessBox, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn, fmtDay } from "@/lib/utils";
import { DECLARED_STATUSES, DETECTION_LABELS, DETECTION_STATES, RISK_SCENARIO_LABELS, THREAT_COVERAGE_STATES, type DetectionState, type CapabilityDto, type CapabilityStatus, type ScenarioProposalDto, type ScenarioStatus, type ThreatCoverageCell, type ThreatCoverageDto, type ThreatCoverageState } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Check, Link2, RefreshCw, X } from "lucide-react";
import { useMemo, useState } from "react";

/* Rizikové scénáře z dat (v1.17, ADR-114): profil schopností a návrhy scénářů ke schválení člověkem.
   Pokrytí katalogu hrozeb u primárních aktiv (v1.18, ADR-115). */

const capTone: Record<CapabilityStatus, Tone> = { strong: "green", partial: "amber", weak: "red", unknown: "slate" };
const statusTone: Record<ScenarioStatus, Tone> = { proposed: "blue", accepted: "green", linked: "violet", rejected: "slate", obsolete: "slate" };
const covTone: Record<ThreatCoverageState, Tone> = { risk: "green", proposed: "blue", not_relevant: "slate", unassessed: "amber" };

export function RiskScenariosPage() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const [tab, setTab] = useTab(["proposals", "capabilities", "coverage", "detection", "decided"] as const, "proposals");
  const open = useQuery({ queryKey: ["scenarios", "open"], queryFn: () => api.risks.scenarios("open") });
  const gen = useMutation({
    mutationFn: api.risks.generateScenarios,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scenarios"] });
      qc.invalidateQueries({ queryKey: ["capabilities"] });
    },
  });
  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/risks" className="hover:text-brand-700">
          {t("rsk.rizika")}
        </Link>
      </div>
      <PageHeader
        title={t("rsc.title")}
        subtitle={t("rsc.subtitle")}
        actions={
          can("risks:write") && (
            <Button disabled={gen.isPending} onClick={() => gen.mutate()}>
              <RefreshCw size={16} className={cn(gen.isPending && "animate-spin")} /> {t("rsc.generate")}
            </Button>
          )
        }
      />
      {gen.data && <SuccessBox>{t("rsc.generated", { created: gen.data.created, reopened: gen.data.reopened, assets: gen.data.primaryAssets })}</SuccessBox>}
      <ErrorBox error={gen.error} />
      <Tabs
        label={t("rsc.title")}
        value={tab}
        onChange={setTab}
        items={(["proposals", "capabilities", "coverage", "detection", "decided"] as const).map((k) => ({
          key: k,
          label: t(`rsc.tab.${k}`),
          badge: k === "proposals" && open.data?.length ? <span className="ml-1.5 rounded-full bg-brand-100 px-1.5 text-xs text-brand-800">{open.data.length}</span> : null,
        }))}
      />
      {tab === "proposals" ? <Proposals list={open.data} loading={open.isLoading} error={open.error} /> : tab === "capabilities" ? <Capabilities /> : tab === "coverage" ? <Coverage /> : tab === "detection" ? <Detection /> : <Decided />}
    </>
  );
}

/* ---------------- návrhy ---------------- */

function Proposals({ list, loading, error }: { list?: ScenarioProposalDto[]; loading: boolean; error: unknown }) {
  const t = useT();
  return (
    <div className="space-y-4" data-testid="rsc-proposals">
      <ErrorBox error={error} />
      {!list?.length ? (
        <Card>
          <EmptyState>{loading ? t("common.loading") : t("rsc.empty")}</EmptyState>
        </Card>
      ) : (
        list.map((p) => <ProposalCard key={p.id + p.generatedAt} p={p} />)
      )}
    </div>
  );
}

function Levels({ p }: { p: ScenarioProposalDto }) {
  const t = useT();
  const box = (label: string, v: number) => (
    <div className="rounded-md border border-slate-200 px-2.5 py-1 text-center">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-lg font-semibold">
        {v}
        <span className="text-xs font-normal text-slate-400"> / {p.levels}</span>
      </div>
    </div>
  );
  return (
    <div className="flex flex-wrap gap-2">
      {box(t("rsc.impact"), p.impact)}
      {box(t("rsc.threat"), p.threatLevel)}
      {box(t("rsc.vuln"), p.vulnLevel)}
    </div>
  );
}

function Reasons({ p }: { p: ScenarioProposalDto }) {
  const t = useT();
  const text = (r: ScenarioProposalDto["reasons"][number]) => {
    const params = { ...(r.params ?? {}) } as Record<string, string | number>;
    if (r.text === "rsc.why.capability") {
      params.cap = t.lbl(RISK_SCENARIO_LABELS.capability[params.cap as keyof typeof RISK_SCENARIO_LABELS.capability] ?? String(params.cap));
      params.status = t.lbl(RISK_SCENARIO_LABELS.status[params.status as CapabilityStatus] ?? String(params.status));
    }
    return t.dyn(r.text, r.text, params);
  };
  return (
    <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">
      {p.reasons.map((r, i) => (
        <li key={i}>{text(r)}</li>
      ))}
    </ul>
  );
}

function ProposalCard({ p }: { p: ScenarioProposalDto }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const nav = useNavigate();
  const group = useGroupView();
  const [dlg, setDlg] = useState<"accept" | "reject" | "link" | null>(null);
  const title = t.lbl(RISK_SCENARIO_LABELS.template[p.templateKey as keyof typeof RISK_SCENARIO_LABELS.template] ?? p.templateKey);
  const done = () => qc.invalidateQueries({ queryKey: ["scenarios"] });
  const reopen = useMutation({ mutationFn: () => api.risks.decideScenario(p.id, { action: "reopen" }), onSuccess: done });
  const edit = can("risks:write");
  return (
    <Card data-testid="rsc-proposal" className="p-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{title}</h3>
            <Badge tone={statusTone[p.status]}>{t.lbl(RISK_SCENARIO_LABELS.scenarioStatus[p.status])}</Badge>
            {p.lowConfidence && <Badge tone="amber">{t("rsc.lowConfidence")}</Badge>}
            {p.changedSinceDecision && <Badge tone="amber">{t("rsc.changed")}</Badge>}
          </div>
          <div className="mt-0.5 text-sm text-slate-600">
            {t("rsc.forAsset")}{" "}
            <Link to="/assets/$assetId" params={{ assetId: p.primaryAssetId }} className="font-medium text-brand-700 hover:underline">
              {p.primaryAssetName}
            </Link>
            {p.supportingAssets.length > 0 && <span className="text-slate-500"> · {t("rsc.supporting", { n: p.supportingAssets.length })}</span>}
          </div>
          {group && <CompanyCell id={p.companyId} />}
        </div>
        <Levels p={p} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("rsc.why")}</div>
          <Reasons p={p} />
        </div>
        <div className="space-y-3">
          {p.hits.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("rsc.evidence")}</div>
              <ul className="space-y-1 text-sm">
                {p.hits.map((h) => (
                  <li key={h.key}>
                    <span className="font-medium">{t.lbl(RISK_SCENARIO_LABELS.signal[h.key])}</span> <span className="text-slate-500">({h.count})</span>
                    {h.items.length > 0 && (
                      <span className="ml-1 text-xs text-slate-500">
                        {h.items.map((it, i) => (
                          <span key={i}>
                            {i > 0 && ", "}
                            {it.path ? (
                              <a href={it.path} className="text-brand-700 hover:underline">
                                {it.label.startsWith("rsc.") ? t.dyn(it.label, it.label) : it.label}
                              </a>
                            ) : (
                              it.label
                            )}
                          </span>
                        ))}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("rsc.capabilities")}</div>
            <div className="flex flex-wrap gap-1.5">
              {p.capabilities.map((c) => (
                <Badge key={c.key} tone={capTone[c.status]}>
                  {t.lbl(RISK_SCENARIO_LABELS.capability[c.key])}: {t.lbl(RISK_SCENARIO_LABELS.status[c.status])}
                </Badge>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("rsc.controls")}</div>
            {p.controls.length ? (
              <ul className="text-sm">
                {p.controls.map((c) => (
                  <li key={c.id}>
                    <Link to="/controls/$controlId" params={{ controlId: c.id }} className="hover:text-brand-700">
                      {c.code && <span className="mr-1 text-slate-500">{c.code}</span>}
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-amber-800">{t("rsc.noControls")}</p>
            )}
          </div>
        </div>
      </div>
      {(p.status === "accepted" || p.status === "linked") && p.riskId && (
        <p className="mt-3 text-sm">
          {t("rsc.riskIs")}{" "}
          <Link to="/risks/$riskId" params={{ riskId: p.riskId }} className="font-medium text-brand-700 hover:underline">
            {p.riskName}
          </Link>
          {p.decidedByName && <span className="text-slate-500"> · {t("rsc.decidedBy", { by: p.decidedByName, date: fmtDay((p.decidedAt ?? "").slice(0, 10)) })}</span>}
        </p>
      )}
      {p.status === "rejected" && (
        <p className="mt-3 text-sm text-slate-600">
          {t("rsc.rejectedBecause")} {p.reason} {p.decidedByName && <span className="text-slate-500">· {t("rsc.decidedBy", { by: p.decidedByName, date: fmtDay((p.decidedAt ?? "").slice(0, 10)) })}</span>}
        </p>
      )}
      {edit && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          {p.status === "proposed" && (
            <>
              <Button onClick={() => setDlg("accept")}>
                <Check size={15} /> {t("rsc.accept")}
              </Button>
              <Button variant="secondary" onClick={() => setDlg("link")}>
                <Link2 size={15} /> {t("rsc.link")}
              </Button>
              <Button variant="secondary" onClick={() => setDlg("reject")}>
                <X size={15} /> {t("rsc.reject")}
              </Button>
            </>
          )}
          {p.status === "rejected" && (
            <Button variant="secondary" disabled={reopen.isPending} onClick={() => reopen.mutate()}>
              {t("rsc.reopen")}
            </Button>
          )}
          <ErrorBox error={reopen.error} />
        </div>
      )}
      {dlg === "accept" && (
        <AcceptModal
          p={p}
          title={title}
          onClose={() => setDlg(null)}
          onDone={(riskId) => {
            done();
            qc.invalidateQueries({ queryKey: ["risks"] });
            toast(t("rsc.accepted"));
            nav({ to: "/risks/$riskId", params: { riskId } });
          }}
        />
      )}
      {dlg === "reject" && <RejectModal p={p} onClose={() => setDlg(null)} onDone={done} />}
      {dlg === "link" && <LinkModal p={p} onClose={() => setDlg(null)} onDone={done} />}
    </Card>
  );
}

function AcceptModal({ p, title, onClose, onDone }: { p: ScenarioProposalDto; title: string; onClose: () => void; onDone: (riskId: string) => void }) {
  const t = useT();
  const [f, setF] = useState({ name: `${title}: ${p.primaryAssetName}`, impact: p.impact, threatLevel: p.threatLevel, vulnLevel: p.vulnLevel });
  const m = useMutation({ mutationFn: () => api.risks.acceptScenario(p.id, f), onSuccess: (r) => (onClose(), onDone(r.riskId)) });
  const lv = (k: "impact" | "threatLevel" | "vulnLevel", label: string) => (
    <Field label={label}>
      <Select value={f[k]} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })}>
        {Array.from({ length: p.levels }, (_, i) => i + 1).map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </Select>
    </Field>
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={t("rsc.acceptTitle")}
      footer={
        <Button disabled={!f.name.trim() || m.isPending} onClick={() => m.mutate()}>
          {t("rsc.acceptConfirm")}
        </Button>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600">{t("rsc.acceptHint")}</p>
        <Field label={t("rsc.riskName")}>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          {lv("impact", t("rsc.impact"))}
          {lv("threatLevel", t("rsc.threat"))}
          {lv("vulnLevel", t("rsc.vuln"))}
        </div>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}

function RejectModal({ p, onClose, onDone }: { p: ScenarioProposalDto; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const m = useMutation({ mutationFn: () => api.risks.decideScenario(p.id, { action: "reject", reason }), onSuccess: () => (onClose(), onDone()) });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("rsc.rejectTitle")}
      footer={
        <Button disabled={reason.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>
          {t("rsc.reject")}
        </Button>
      }
    >
      <Field label={t("rsc.rejectReason")} hint={t("rsc.rejectHint")}>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <ErrorBox error={m.error} />
    </Modal>
  );
}

function LinkModal({ p, onClose, onDone }: { p: ScenarioProposalDto; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [riskId, setRiskId] = useState("");
  const risks = useQuery({ queryKey: ["risks", "pick", q], queryFn: () => api.risks.list({ q: q || undefined, limit: 50 }) });
  const m = useMutation({ mutationFn: () => api.risks.decideScenario(p.id, { action: "link", riskId }), onSuccess: () => (onClose(), onDone()) });
  const items = (risks.data?.items ?? []).filter((r) => r.companyId === p.companyId);
  return (
    <Modal
      open
      onClose={onClose}
      title={t("rsc.linkTitle")}
      footer={
        <Button disabled={!riskId || m.isPending} onClick={() => m.mutate()}>
          {t("rsc.link")}
        </Button>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600">{t("rsc.linkHint")}</p>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("rsc.searchRisk")} aria-label={t("rsc.searchRisk")} />
        <Select value={riskId} onChange={(e) => setRiskId(e.target.value)} aria-label={t("rsc.pickRisk")}>
          <option value="">{t("rsc.pickRisk")}</option>
          {items.map((r) => (
            <option key={r.id} value={r.id}>
              {r.code ? `${r.code} ` : ""}
              {r.name}
            </option>
          ))}
        </Select>
        <ErrorBox error={risks.error ?? m.error} />
      </div>
    </Modal>
  );
}

function Decided() {
  const t = useT();
  const q = useQuery({ queryKey: ["scenarios", "all"], queryFn: () => api.risks.scenarios("all") });
  const list = (q.data ?? []).filter((p) => p.status !== "proposed");
  return (
    <div className="space-y-4" data-testid="rsc-decided">
      <ErrorBox error={q.error} />
      {!list.length ? (
        <Card>
          <EmptyState>{q.isLoading ? t("common.loading") : t("rsc.noDecided")}</EmptyState>
        </Card>
      ) : (
        list.map((p) => <ProposalCard key={p.id + p.generatedAt + p.status} p={p} />)
      )}
    </div>
  );
}

/* ---------------- pokrytí katalogu hrozeb (v1.18) ---------------- */

function Coverage() {
  const t = useT();
  const q = useQuery({ queryKey: ["threat-coverage"], queryFn: api.risks.threatCoverage });
  const [assetId, setAssetId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | ThreatCoverageState>("unassessed");
  const d = q.data;
  const asset = d?.assets.find((a) => a.id === assetId) ?? d?.assets[0] ?? null;
  const pct = (x: number | null) => (x == null ? "–" : `${Math.round(x * 100)} %`);
  return (
    <div className="space-y-4" data-testid="rsc-coverage">
      <p className="text-sm text-slate-600">
        {t("rsc.cov.intro")}{" "}
        <Link to="/risks" className="text-brand-700 hover:underline">
          {t("rsc.cov.report")}
        </Link>
      </p>
      <ErrorBox error={q.error} />
      {d && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="rsc-cov-summary">
            <b>{t("rsc.cov.assessed", { pct: pct(d.summary.assessedShare) })}</b>
            {THREAT_COVERAGE_STATES.map((s) => (
              <Badge key={s} tone={covTone[s]}>
                {t.lbl(RISK_SCENARIO_LABELS.coverage[s])}: {d.summary[s]}
              </Badge>
            ))}
          </div>
        </Card>
      )}
      {d && !d.assets.length && (
        <Card>
          <EmptyState>{t("rsc.cov.noAssets")}</EmptyState>
        </Card>
      )}
      {d && asset && (
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <Card className="overflow-hidden">
            <ul className="divide-y divide-slate-100 text-sm">
              {d.assets.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className={cn("flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50", a.id === asset.id && "bg-brand-50")}
                    onClick={() => setAssetId(a.id)}
                  >
                    <span className="truncate">{a.name}</span>
                    <span className={cn("shrink-0 text-xs", a.assessed < d.threats.length ? "text-amber-700" : "text-green-700")}>
                      {a.assessed}/{d.threats.length}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader
              title={asset.name}
              action={
                <Select aria-label={t("rsc.cov.filter")} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
                  <option value="all">{t("rsc.cov.all")}</option>
                  {THREAT_COVERAGE_STATES.map((s) => (
                    <option key={s} value={s}>
                      {t.lbl(RISK_SCENARIO_LABELS.coverage[s])}
                    </option>
                  ))}
                </Select>
              }
            />
            <div className="px-5 py-3">
              <CoverageTable d={d} assetId={asset.id} cells={asset.cells} filter={filter} />
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function CoverageTable({ d, assetId, cells, filter }: { d: ThreatCoverageDto; assetId: string; cells: Record<string, ThreatCoverageCell>; filter: "all" | ThreatCoverageState }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const [marking, setMarking] = useState<{ id: string; name: string } | null>(null);
  const [reason, setReason] = useState("");
  const rows = useMemo(() => d.threats.filter((x) => filter === "all" || cells[x.id]?.state === filter), [d, cells, filter]);
  const done = (r: ThreatCoverageDto) => qc.setQueryData(["threat-coverage"], r);
  const mark = useMutation({
    mutationFn: () => api.risks.markNotRelevant(assetId, marking!.id, reason),
    onSuccess: (r) => {
      done(r);
      setMarking(null);
      setReason("");
      toast(t("rsc.cov.saved"));
    },
  });
  const unmark = useMutation({ mutationFn: (catalogId: string) => api.risks.unmarkNotRelevant(assetId, catalogId), onSuccess: done });
  const assetName = d.assets.find((a) => a.id === assetId)?.name ?? "";
  const task = useMutation({
    mutationFn: (x: { code: string | null; name: string }) =>
      api.actions.create({ title: t("rsc.cov.taskTitle", { threat: `${x.code ? `${x.code} ` : ""}${x.name}`, asset: assetName }).slice(0, 500), description: t("rsc.cov.taskDesc"), sourceKind: "asset", sourceId: assetId, priority: "medium", status: "open" }),
    onSuccess: () => toast(t("rsc.cov.taskCreated")),
  });
  if (!rows.length) return <EmptyState>{t("rsc.cov.none")}</EmptyState>;
  return (
    <>
      <ErrorBox error={unmark.error ?? task.error} />
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-slate-500">
            <th className="py-1.5 pr-2">{t("rsc.cov.threat")}</th>
            <th className="py-1.5 pr-2">{t("rsc.cov.state")}</th>
            <th className="py-1.5" />
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => {
            const c = cells[x.id]!;
            return (
              <tr key={x.id} className="border-b border-slate-100 align-top" data-testid="rsc-cov-row">
                <td className="py-2 pr-2">
                  <div>
                    {x.code && <span className="mr-1 font-mono text-xs text-slate-500">{x.code}</span>}
                    {x.name}
                  </div>
                  {x.category && <div className="text-xs text-slate-500">{x.category}</div>}
                </td>
                <td className="py-2 pr-2">
                  <Badge tone={covTone[c.state]}>{t.lbl(RISK_SCENARIO_LABELS.coverage[c.state])}</Badge>
                  {c.risks.map((r) => (
                    <div key={r.id} className="text-xs">
                      <Link to="/risks/$riskId" params={{ riskId: r.id }} className="text-brand-700 hover:underline">
                        {r.name}
                      </Link>
                    </div>
                  ))}
                  {c.state === "proposed" && (
                    <div className="text-xs">
                      <Link to="/risks/scenarios" search={{ tab: "proposals" } as never} className="text-brand-700 hover:underline">
                        {t("rsc.cov.toProposals")}
                      </Link>
                    </div>
                  )}
                  {c.reason && (
                    <div className="mt-1 text-xs text-slate-600">
                      {c.reason}
                      <span className="text-slate-400">
                        {" "}
                        · {c.decidedByName} · {c.decidedAt && fmtDay(c.decidedAt.slice(0, 10))}
                      </span>
                    </div>
                  )}
                </td>
                <td className="py-2 text-right">
                  {can("risks:write") && c.state === "unassessed" && (
                    <div className="flex justify-end gap-1">
                      <Button variant="secondary" disabled={task.isPending} onClick={() => task.mutate(x)}>
                        {t("rsc.cov.task")}
                      </Button>
                      <Button variant="secondary" onClick={() => setMarking({ id: x.id, name: x.name })}>
                        {t("rsc.cov.markNa")}
                      </Button>
                    </div>
                  )}
                  {can("risks:write") && c.reason && (
                    <Button variant="secondary" disabled={unmark.isPending} onClick={async () => (await askConfirm(t("rsc.cov.unmarkQ"))) && unmark.mutate(x.id)}>
                      {t("rsc.remove")}
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Modal
        open={!!marking}
        onClose={() => setMarking(null)}
        title={t("rsc.cov.markTitle", { name: marking?.name ?? "" })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setMarking(null)}>
              {t("rsc.cancel")}
            </Button>
            <Button disabled={reason.trim().length < 5 || mark.isPending} onClick={() => mark.mutate()}>
              {t("rsc.save")}
            </Button>
          </>
        }
      >
        <p className="mb-2 text-sm text-slate-600">{t("rsc.cov.markHint")}</p>
        <Field label={t("rsc.cov.reason")}>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorBox error={mark.error} />
      </Modal>
    </>
  );
}

/* ---------------- pokrytí ATT&CK detekcí (v1.22) ---------------- */

const detTone: Record<DetectionState, Tone> = { detected: "green", hunted: "blue", declared: "violet", blind: "red" };

function Detection() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["detection"], queryFn: api.risks.detection });
  const [editing, setEditing] = useState<string | null>(null);
  const [f, setF] = useState({ source: "", note: "" });
  const done = (r: Awaited<ReturnType<typeof api.risks.detection>>) => qc.setQueryData(["detection"], r);
  const save = useMutation({ mutationFn: () => api.risks.declareDetection(editing!, { source: f.source, note: f.note || null }), onSuccess: (r) => (done(r), setEditing(null)) });
  const rm = useMutation({ mutationFn: (id: string) => api.risks.removeDetection(id), onSuccess: done });
  const d = q.data;
  return (
    <div className="space-y-4" data-testid="rsc-detection">
      <p className="text-sm text-slate-600">{t("rsc.det.intro")}</p>
      <ErrorBox error={q.error ?? rm.error} />
      {d && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {!d.measured && <Badge tone="slate">{t("rsc.det.notMeasured")}</Badge>}
            {DETECTION_STATES.map((s) => (
              <Badge key={s} tone={detTone[s]}>
                {t.lbl(DETECTION_LABELS.state[s])}: {d.summary[s]}
              </Badge>
            ))}
          </div>
        </Card>
      )}
      {d && (
        <Card>
          <div className="px-5 py-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-1.5 pr-2">{t("rsc.det.technique")}</th>
                  <th className="py-1.5 pr-2">{t("rsc.cov.state")}</th>
                  <th className="py-1.5 pr-2">{t("rsc.det.evidence")}</th>
                  <th className="py-1.5" />
                </tr>
              </thead>
              <tbody>
                {d.techniques.map((x) => (
                  <tr key={x.id} className="border-b border-slate-100 align-top" data-testid="rsc-det-row">
                    <td className="py-2 pr-2">
                      <span className="mr-1 font-mono text-xs text-slate-500">{x.id}</span>
                      {x.name ?? ""}
                      <div className="text-xs text-slate-500">{x.templates.map((k) => t.lbl(RISK_SCENARIO_LABELS.template[k as keyof typeof RISK_SCENARIO_LABELS.template] ?? k)).join(" · ")}</div>
                    </td>
                    <td className="py-2 pr-2">
                      <Badge tone={detTone[x.state]}>{t.lbl(DETECTION_LABELS.state[x.state])}</Badge>
                    </td>
                    <td className="py-2 pr-2 text-xs text-slate-600">
                      {x.alerts > 0 && <div>{t("rsc.det.alerts", { n: x.alerts })}</div>}
                      {x.hunts.map((h) => (
                        <div key={h.id}>{t("rsc.det.hunt", { name: h.name })}</div>
                      ))}
                      {x.declaration && (
                        <div>
                          {t("rsc.det.declared", { source: x.declaration.source })}
                          {x.declaration.note ? ` – ${x.declaration.note}` : ""}
                          <span className="text-slate-400"> · {x.declaration.byName} · {fmtDay(x.declaration.at.slice(0, 10))}</span>
                        </div>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {can("risks:write") && !x.declaration && (
                        <Button variant="secondary" onClick={() => (setEditing(x.id), setF({ source: "", note: "" }))}>
                          {t("rsc.det.declare")}
                        </Button>
                      )}
                      {can("risks:write") && x.declaration && (
                        <Button variant="secondary" disabled={rm.isPending} onClick={async () => (await askConfirm(t("rsc.det.removeQ"))) && rm.mutate(x.id)}>
                          {t("rsc.remove")}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={t("rsc.det.declareTitle", { id: editing ?? "" })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              {t("rsc.cancel")}
            </Button>
            <Button disabled={f.source.trim().length < 3 || save.isPending} onClick={() => save.mutate()}>
              {t("rsc.save")}
            </Button>
          </>
        }
      >
        <p className="mb-2 text-sm text-slate-600">{t("rsc.det.declareHint")}</p>
        <Field label={t("rsc.det.source")}>
          <Input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="Wazuh 100210, Defender ASR…" />
        </Field>
        <Field label={t("rsc.note")}>
          <Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
        <ErrorBox error={save.error} />
      </Modal>
    </div>
  );
}

/* ---------------- profil schopností ---------------- */

function Capabilities() {
  const t = useT();
  const q = useQuery({ queryKey: ["capabilities"], queryFn: api.risks.capabilities });
  return (
    <div data-testid="rsc-capabilities">
      <p className="mb-4 text-sm text-slate-600">{t("rsc.capIntro")}</p>
      <ErrorBox error={q.error} />
      <div className="grid gap-4 lg:grid-cols-2">
        {(q.data ?? []).map((c) => (
          <CapabilityCard key={c.key + (c.declaration?.at ?? "")} c={c} />
        ))}
      </div>
    </div>
  );
}

function CapabilityCard({ c }: { c: CapabilityDto }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const d = c.declaration;
  const [f, setF] = useState({ status: (d?.status === "unknown" ? "partial" : (d?.status ?? "partial")) as (typeof DECLARED_STATUSES)[number], product: d?.product ?? "", note: d?.note ?? "", url: d?.url ?? "", validUntil: d?.validUntil ?? "" });
  const done = (x: CapabilityDto[]) => {
    qc.setQueryData(["capabilities"], x);
    setEditing(false);
  };
  const save = useMutation({ mutationFn: () => api.risks.declareCapability(c.key, { status: f.status, product: f.product || null, note: f.note || null, url: f.url || null, validUntil: f.validUntil || null }), onSuccess: done });
  const rm = useMutation({ mutationFn: () => api.risks.removeDeclaration(c.key), onSuccess: done });
  const label = t.lbl(RISK_SCENARIO_LABELS.capability[c.key]);
  return (
    <Card className="p-4" data-testid={`cap-${c.key}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{label}</h3>
        <Badge tone={capTone[c.status]}>{t.lbl(RISK_SCENARIO_LABELS.status[c.status])}</Badge>
        <span className="text-xs text-slate-500">{t.lbl(RISK_SCENARIO_LABELS.confidence[c.confidence])}</span>
      </div>
      {c.coverage != null && (
        <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className={cn("h-full", c.status === "strong" ? "bg-emerald-500" : c.status === "partial" ? "bg-amber-500" : "bg-red-500")} style={{ width: `${Math.round(c.coverage * 100)}%` }} />
          </div>
          {Math.round(c.coverage * 100)} %
        </div>
      )}
      {c.metrics.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-sm text-slate-700">
          {c.metrics.map((m) => (
            <li key={m.key}>{t.dyn(`rsc.metric.${m.key}`, m.key, { value: m.value, total: m.total ?? 0 })}</li>
          ))}
        </ul>
      )}
      {c.measuredStatus === "unknown" && <p className="mt-2 text-sm text-slate-500">{t("rsc.noData")}</p>}
      {c.conflict && (
        <p className="mt-2 flex items-center gap-1 text-sm text-amber-800">
          <AlertTriangle size={14} /> {t("rsc.conflict")}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        {c.links.map((l) => (
          <a key={l.path} href={l.path} className="text-brand-700 hover:underline">
            {t.dyn(l.label, l.label)}
          </a>
        ))}
        <span className="text-slate-500" title={c.requirements.ids.join(", ")}>
          {t("rsc.refs", { iso: c.requirements.ids.filter((x) => x.startsWith("iso27001:")).map((x) => x.slice(9)).join(", "), d409: c.requirements.decree409.join(", ") })}
        </span>
      </div>
      {d && !editing && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2 text-sm">
          <div>
            <b>{t("rsc.declared")}</b> {t.lbl(RISK_SCENARIO_LABELS.status[d.status])}
            {d.product && ` · ${d.product}`}
            {d.expired && <Badge tone="amber">{t("rsc.expired")}</Badge>}
          </div>
          {d.note && <div className="text-slate-600">{d.note}</div>}
          <div className="text-xs text-slate-500">
            {d.byName} · {fmtDay(d.at.slice(0, 10))}
            {d.validUntil && ` · ${t("rsc.validUntil")} ${fmtDay(d.validUntil)}`}
            {d.url && (
              <>
                {" · "}
                <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">
                  {t("rsc.evidenceLink")}
                </a>
              </>
            )}
          </div>
        </div>
      )}
      {can("risks:write") && !editing && (
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {d ? t("rsc.editDeclaration") : t("rsc.declare")}
          </Button>
          {d && (
            <Button variant="secondary" disabled={rm.isPending} onClick={async () => (await askConfirm(t("rsc.removeDeclaration"))) && rm.mutate()}>
              {t("rsc.remove")}
            </Button>
          )}
        </div>
      )}
      {editing && (
        <div className="mt-3 space-y-2 rounded-md border border-slate-200 p-3">
          <p className="text-xs text-slate-500">{t("rsc.declareHint")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={t("rsc.declaredStatus")}>
              <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as typeof f.status })}>
                {DECLARED_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t.lbl(RISK_SCENARIO_LABELS.status[s])}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("rsc.product")}>
              <Input value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })} placeholder="FortiGate, Defender, CyberArk…" />
            </Field>
          </div>
          <Field label={t("rsc.note")}>
            <Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={t("rsc.evidenceLink")}>
              <Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://…" />
            </Field>
            <Field label={t("rsc.validUntil")}>
              <Input type="date" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {t("rsc.save")}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              {t("rsc.cancel")}
            </Button>
          </div>
          <ErrorBox error={save.error ?? rm.error} />
        </div>
      )}
    </Card>
  );
}
