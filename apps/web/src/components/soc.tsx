/** SOC (v0.51, ADR-046) – sdílené prvky: závažnost, stav, techniky ATT&CK, pás taktik, poradce. */
import { Badge, Button, Card, CardHeader, ErrorBox, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { RiskLevelBadge } from "@/components/risk";
import { ATTACK_TACTICS, SOC_LABELS, attackTactic, attackTechnique, attackUrl, slaWorst, type SlaState, type ManagementReport, type SocAiTriage, type SocExposure, type TiMatch, TI_FEEDS, TI_LABELS, defang, type SocLinkedRisk, type SocPlaybook, type SocSeverity, type SocSla } from "@contix/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bot, Loader2, Radar, Send, ShieldAlert, Skull, Sparkles } from "lucide-react";
import { useState } from "react";

export const severityTone: Record<SocSeverity, Tone> = { low: "slate", medium: "blue", high: "amber", critical: "red" };
export const socStatusTone: Record<string, Tone> = { new: "violet", in_progress: "blue", accepted: "red", dismissed: "slate" };

export function SeverityBadge({ s }: { s: SocSeverity }) {
  const t = useT();
  return <Badge tone={severityTone[s]}>{t.lbl(SOC_LABELS.severity[s])}</Badge>;
}
/** Návrh AI předběžné triáže (ADR-051) – jen návrh, analytik rozhoduje. */
export function AiTriageBadge({ tr }: { tr: SocAiTriage | null }) {
  const t = useT();
  if (!tr) return <span className="text-xs text-slate-400">—</span>;
  if (tr.error || !tr.verdict) return <span className="text-xs text-slate-400" title={tr.error ?? ""}>{t("soc.aiTriage.failed")}</span>;
  const tone: Tone = tr.verdict === "true_positive" ? "red" : tr.verdict === "undetermined" ? "amber" : "green";
  return (
    <span className="inline-flex items-center gap-1" title={`${t.lbl(SOC_LABELS.confidence[tr.confidence ?? "low"])} – ${tr.reasoning}`} data-testid="ai-triage-badge">
      <Badge tone={tone}>
        <Sparkles size={11} className="mr-0.5 inline" />
        {t.lbl(SOC_LABELS.verdict[tr.verdict])}
      </Badge>
      {tr.confidence === "low" && <span className="text-[10px] text-slate-400">?</span>}
    </span>
  );
}

export function SocStatusBadge({ s }: { s: string }) {
  const t = useT();
  return <Badge tone={socStatusTone[s] ?? "slate"}>{t.lbl(SOC_LABELS.status[s] ?? s)}</Badge>;
}

const slaTone: Record<SlaState, Tone> = { breached: "red", soon: "amber", late: "amber", ok: "slate", met: "green" };

/** Zbývající čas do termínu (nebo jak dlouho je po něm). */
export function useRemaining() {
  const t = useT();
  return (iso: string) => {
    const ms = new Date(iso).getTime() - Date.now();
    const abs = Math.abs(ms);
    const v = abs < 3600_000 ? t("soc.sla.min", { n: Math.max(1, Math.round(abs / 60_000)) }) : abs < 48 * 3600_000 ? t("soc.sla.hours", { n: Math.round(abs / 3600_000) }) : t("soc.sla.days", { n: Math.round(abs / 864e5) });
    return ms >= 0 ? t("soc.sla.left", { v }) : t("soc.sla.over", { v });
  };
}

/** Stav lhůt: převzetí (dokud nepřevzato), jinak vyřešení. */
export function SlaBadge({ sla, acknowledged }: { sla: SocSla | null; acknowledged: boolean }) {
  const t = useT();
  const rem = useRemaining();
  if (!sla) return <span className="text-xs text-slate-400">—</span>;
  const stage = !acknowledged && (sla.ack === "ok" || sla.ack === "soon" || sla.ack === "breached") ? "ack" : "resolve";
  const state = stage === "ack" ? sla.ack : sla.resolve;
  const due = stage === "ack" ? sla.ackDue : sla.resolveDue;
  const running = state === "ok" || state === "soon" || state === "breached";
  return (
    <span className="inline-flex flex-col gap-0.5" data-sla={slaWorst(sla) ?? undefined}>
      <Badge tone={slaTone[state]}>
        {t(stage === "ack" ? "soc.sla.ack" : "soc.sla.resolve")}: {t.lbl(SOC_LABELS.sla[state])}
      </Badge>
      {running && <span className="text-[11px] tabular-nums text-slate-500">{rem(due)}</span>}
    </span>
  );
}

/** Název taktiky v jazyce rozhraní. */
export function useTacticName() {
  const t = useT();
  return (id: string) => {
    const ta = attackTactic(id);
    return ta ? (t.locale === "cs" ? ta.cs : ta.name) : id;
  };
}

export function usePlaybookText() {
  const t = useT();
  const l = t.locale === "cs" ? "cs" : "en";
  return { name: (p: SocPlaybook) => p.name[l], step: (s: { cs: string; en: string }) => s[l] };
}

/** Techniky ATT&CK jako odkazy na attack.mitre.org. */
export function MitreBadges({ ids, className }: { ids: string[]; className?: string }) {
  if (!ids.length) return <span className="text-xs text-slate-400">—</span>;
  return (
    <span className={cn("inline-flex flex-wrap gap-1", className)}>
      {ids.map((id) => (
        <a key={id} href={attackUrl(id)} target="_blank" rel="noreferrer" title={attackTechnique(id)?.name ?? id} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 hover:border-brand-300 hover:text-brand-700">
          {id}
        </a>
      ))}
    </span>
  );
}

/** Pás taktik ATT&CK s počty alertů (posledních 30 dní) – kliknutím filtr. */
export function TacticStrip({ counts, active, onPick }: { counts: Record<string, number>; active?: string; onPick: (id: string | undefined) => void }) {
  const t = useT();
  const name = useTacticName();
  const max = Math.max(1, ...Object.values(counts));
  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader title={t("soc.tactics.title")} subtitle={t("soc.tactics.subtitle")} />
      <div className="grid grid-cols-2 gap-1 p-3 sm:grid-cols-4 lg:grid-cols-7">
        {ATTACK_TACTICS.map((ta) => {
          const n = counts[ta.id] ?? 0;
          const on = active === ta.id;
          return (
            <button
              key={ta.id}
              type="button"
              onClick={() => onPick(on ? undefined : ta.id)}
              aria-pressed={on}
              title={`${ta.id} ${ta.name}`}
              className={cn("rounded-md border px-2 py-1.5 text-left transition", on ? "border-brand-500 ring-1 ring-brand-500" : "border-slate-200 hover:border-slate-300", n === 0 && !on && "opacity-60")}
              style={n ? { backgroundColor: `rgba(220, 38, 38, ${0.06 + 0.3 * (n / max)})` } : undefined}
            >
              <div className="truncate text-[11px] text-slate-600">{name(ta.id)}</div>
              <div className="text-sm font-semibold tabular-nums text-slate-900">{n}</div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

const QUICK = [
  "Jak poznám útok hádáním hesel a jak se bránit?",
  "Jak postupovat při podezření na ransomware?",
  "Co je Kerberoasting a jak ho detekovat?",
  "Jaké techniky ATT&CK nejčastěji předcházejí úniku dat?",
];

/** Poradce SOC – typy útoků, techniky, zranitelnosti; nad konkrétním alertem s jeho kontextem. */
export function SocAdvisorCard({ alertId, className }: { alertId?: string; className?: string }) {
  const t = useT();
  const [q, setQ] = useState("");
  const ask = useMutation({ mutationFn: (question: string) => api.soc.advisor(question, alertId) });
  const submit = (v: string) => {
    if (v.trim().length >= 3 && !ask.isPending) {
      setQ(v);
      ask.mutate(v.trim());
    }
  };
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader title={t("soc.advisor.title")} subtitle={alertId ? t("soc.advisor.subtitleAlert") : t("soc.advisor.subtitle")} action={<Bot size={16} className="text-slate-400" aria-hidden />} />
      <form
        className="space-y-2 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit(q);
        }}
      >
        <Textarea rows={2} value={q} maxLength={2000} aria-label={t("soc.advisor.label")} placeholder={alertId ? t("soc.advisor.placeholderAlert") : t("soc.advisor.placeholder")} onChange={(e) => setQ(e.target.value)} />
        <div className="flex flex-wrap items-center gap-1.5">
          {!alertId &&
            QUICK.map((x) => (
              <button key={x} type="button" disabled={ask.isPending} onClick={() => submit(t.lbl(x))} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-brand-300 hover:text-brand-700 disabled:opacity-50">
                {t.lbl(x)}
              </button>
            ))}
          <Button type="submit" className="ml-auto" disabled={q.trim().length < 3 || ask.isPending}>
            {ask.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {t("soc.advisor.ask")}
          </Button>
        </div>
        <ErrorBox error={ask.error} />
        {ask.isPending && <p className="text-xs text-slate-500">{t("ai.modelPripravujeOdpovedLokalniModel")}</p>}
        {ask.data && (
          <div className="rounded-md border border-violet-200 bg-violet-50/60 px-4 py-3 text-sm leading-relaxed text-slate-800" data-testid="soc-advisor-answer">
            <div className="whitespace-pre-wrap">{ask.data.answer}</div>
            <p className="mt-2 text-xs text-slate-500">
              {ask.data.model} · {Math.round(ask.data.durationMs / 1000)} s · {t("soc.advisor.disclaimer")}
            </p>
          </div>
        )}
      </form>
    </Card>
  );
}

/* ---------- SOC × zranitelnosti a rizika (v0.53, ADR-048) ---------- */

/** Štítek vazby alertu na zranitelnosti aktiva (zneužití = závažnost zvýšena). */
export function ExposureBadge({ e }: { e: SocExposure | null | undefined }) {
  const t = useT();
  if (!e) return null;
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium", e.exploit ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800")}
      title={`${t.lbl(SOC_LABELS.exposure[e.reason])}${e.cves.length ? `: ${e.cves.join(", ")}` : ""}`}
    >
      <ShieldAlert size={12} aria-hidden /> {e.exploit ? t("soc.exp.exploit") : t("soc.exp.vulnerable")}
    </span>
  );
}

/** Upozornění v detailu alertu: pokus o zneužití známé zranitelnosti. */
/** Shoda s veřejnými zdroji hrozeb (ADR-057). */
export function IntelBadge({ m }: { m: TiMatch[] | null | undefined }) {
  const t = useT();
  if (!m?.length) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700" title={m.map((x) => `${x.value} – ${x.source}${x.threat ? `, ${x.threat}` : ""}`).join("\n")} data-testid="intel-badge">
      <Skull size={12} aria-hidden /> {t("soc.ti.known")}
    </span>
  );
}
export function IntelBanner({ m }: { m: TiMatch[] | null | undefined }) {
  const t = useT();
  if (!m?.length) return null;
  return (
    <div className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900" role="note" data-testid="intel-banner">
      <Skull size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div>
        <div className="font-medium">{t("soc.ti.bannerTitle")}</div>
        <ul className="text-xs">
          {m.map((x) => (
            <li key={`${x.source}|${x.type}|${x.value}`}>
              <span className="font-mono">{defang(x.type, x.value)}</span> – {TI_SOURCE_NAME(x.source, t.lbl)}
              {x.threat && ` · ${x.threat}`}
              {x.confidence != null && ` · ${t("soc.ti.confidence", { n: x.confidence })}`}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
const TI_SOURCE_NAME = (s: string, lbl: (x: string) => string) => ((TI_FEEDS as readonly string[]).includes(s) ? lbl(TI_LABELS.feed[s as keyof typeof TI_LABELS.feed]) : s.replace(/^custom:/, ""));

export function ExposureBanner({ e }: { e: SocExposure | null | undefined }) {
  const t = useT();
  if (!e) return null;
  return (
    <div className={cn("mb-4 flex items-start gap-2 rounded-md border px-4 py-3 text-sm", e.exploit ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900")} role="note">
      <ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div>
        <div className="font-medium">{t.lbl(SOC_LABELS.exposure[e.reason])}</div>
        <div className="text-xs">
          {e.exploit ? t("soc.exp.bumped") : t("soc.exp.info", { n: e.highVulns })}
          {e.cves.length > 0 && <> · {e.cves.join(", ")}</>}
        </div>
      </div>
    </div>
  );
}

/** Rizika z registru navázaná na aktiva alertu / případu. */
export function LinkedRisksCard({ risks, className }: { risks: SocLinkedRisk[]; className?: string }) {
  const t = useT();
  if (!risks.length) return null;
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader title={t("soc.risks.title")} subtitle={t("soc.risks.subtitle")} />
      <ul className="divide-y divide-slate-100 text-sm">
        {risks.map((r) => (
          <li key={r.id} className="px-4 py-2">
            <div className="flex items-center justify-between gap-2">
              <Link to="/risks/$riskId" params={{ riskId: r.id }} className="font-medium text-brand-700 hover:underline">
                {r.name}
              </Link>
              <RiskLevelBadge level={r.level} />
            </div>
            <div className="text-xs text-slate-500">{t("soc.risks.asset", { asset: r.assetName })}</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Karta na detailu rizika: alerty SOC na aktivech rizika za 90 dní a doporučení přehodnotit. */
export function RiskSocSignalsCard({ riskId, className }: { riskId: string; className?: string }) {
  const t = useT();
  const tactic = useTacticName();
  const q = useQuery({ queryKey: ["soc", "risk-signals", riskId], queryFn: () => api.soc.riskSignals(riskId), retry: false, staleTime: 60_000 });
  const s = q.data;
  if (q.isError || !s) return null;
  const tactics = Object.entries(s.tactics).sort((a, b) => b[1] - a[1]).slice(0, 4);
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader title={t("soc.sig.title")} subtitle={t("soc.sig.subtitle", { days: s.days })} action={<Radar size={16} className="text-slate-400" aria-hidden />} />
      {s.alerts === 0 ? (
        <p className="px-5 py-3 text-sm text-slate-500">{t("soc.sig.none")}</p>
      ) : (
        <div className="space-y-3 p-4 text-sm">
          {s.reassess && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900" role="note">
              {t("soc.sig.reassess")}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <Stat label={t("soc.sig.alerts")} value={s.alerts} />
            <Stat label={t("soc.sig.escalated")} value={s.escalated + s.truePositive} />
            <Stat label={t("soc.sig.exploit")} value={s.exploitAttempts} />
            <Stat label={t("soc.sig.fp")} value={s.falsePositive} />
          </div>
          {tactics.length > 0 && <p className="text-xs text-slate-600">{t("soc.sig.tactics", { list: tactics.map(([id, n]) => `${tactic(id)} (${n})`).join(", ") })}</p>}
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-100">
            {s.recent.slice(0, 5).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                <Link to="/soc/$alertId" params={{ alertId: a.id }} className="min-w-0 truncate hover:text-brand-700">
                  {a.title}
                </Link>
                <span className="flex shrink-0 items-center gap-1.5">
                  <ExposureBadge e={a.exposure} />
                  <SeverityBadge s={a.severity} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
const Stat = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded-md border border-slate-200 px-2 py-1.5">
    <div className="text-slate-500">{label}</div>
    <div className="text-base font-semibold tabular-nums text-slate-900">{value}</div>
  </div>
);

/** Sekce SOC ve zprávě pro vedení (ADR-048). */
export function SocReportCard({ s }: { s: NonNullable<ManagementReport["soc"]> }) {
  const t = useT();
  const tactic = useTacticName();
  return (
    <Card className="overflow-hidden">
      <CardHeader title={t("soc.rep.title")} subtitle={t("soc.rep.subtitle")} />
      <div className="space-y-3 p-5 text-sm">
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <Stat label={t("soc.sig.alerts")} value={s.alerts} />
          <Stat label={t("soc.sig.escalated")} value={s.escalated} />
          <Stat label={t("soc.sig.exploit")} value={s.exploitAttempts} />
          <Stat label={t("soc.kpi.slaBreached")} value={s.openBreached} />
        </div>
        <p className="text-slate-700">
          {t("soc.rep.text", {
            fp: s.fpRate == null ? "—" : `${Math.round(s.fpRate * 100)} %`,
            mtta: s.mttaHours == null ? "—" : `${s.mttaHours} h`,
            tp: s.truePositive,
            fpN: s.falsePositive + s.benign,
          })}
        </p>
        {s.topTactics.length > 0 && <p className="text-xs text-slate-600">{t("soc.sig.tactics", { list: s.topTactics.map((x) => `${tactic(x.id)} (${x.n})`).join(", ") })}</p>}
      </div>
    </Card>
  );
}
