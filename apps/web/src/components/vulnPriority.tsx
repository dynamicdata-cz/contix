/**
 * Prioritizace zranitelností (v0.54, ADR-049): priority P1–P4 z CISA KEV, EPSS, závažnosti a kritičnosti aktiva,
 * plán oprav po balíčcích, správa veřejných zdrojů hrozeb.
 */
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, Modal, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useMe } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn, fmtDate } from "@/lib/utils";
import { VULN_INTEL_LABELS, VULN_PRIORITIES, type VulnFixPlanItem, type VulnPriority, type VulnPriorityReason, type VulnSla, type VulnSummaryDto } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Flame, Settings2, ShieldAlert, Upload } from "lucide-react";
import { useRef, useState } from "react";

export const priorityTone: Record<VulnPriority, Tone> = { p1: "red", p2: "amber", p3: "blue", p4: "slate" };

export function PriorityBadge({ p, reasons }: { p: VulnPriority; reasons?: VulnPriorityReason[] }) {
  const t = useT();
  return (
    <span title={reasons?.map((r) => t.lbl(VULN_INTEL_LABELS.reason[r])).join(" · ")}>
      <Badge tone={priorityTone[p]}>{t.lbl(VULN_INTEL_LABELS.priorityShort[p])}</Badge>
    </span>
  );
}

export function KevBadge({ ransomware }: { ransomware?: boolean }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-0.5 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white" title={t(ransomware ? "vp.kevRansomwareHint" : "vp.kevHint")}>
      {ransomware && <Flame size={10} aria-hidden />}KEV
    </span>
  );
}

export const epssText = (e: number | null | undefined) => (e == null ? "—" : `${e >= 0.1 ? Math.round(e * 100) : Math.round(e * 1000) / 10} %`);

/** Přehled priorit: dlaždice P1–P4, KEV a stav zdrojů hrozeb. */
export function PrioritySection({ s, onPick }: { s: VulnSummaryDto; onPick: (p: VulnPriority | "kev" | "overdue") => void }) {
  const t = useT();
  const can = useCan();
  const [settings, setSettings] = useState(false);
  const fresh = s.intel.kevUpdatedAt || s.intel.epssUpdatedAt;
  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader
        title={t("vp.title")}
        subtitle={t("vp.subtitle")}
        action={
          can("admin:settings") && (
            <Button variant="secondary" onClick={() => setSettings(true)}>
              <Settings2 size={15} /> {t("vp.sources")}
            </Button>
          )
        }
      />
      <div className="grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
        {VULN_PRIORITIES.map((p) => (
          <button key={p} type="button" onClick={() => onPick(p)} className="rounded-lg border border-slate-200 p-3 text-left transition hover:border-brand-300">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
              <PriorityBadge p={p} /> {t.lbl(VULN_INTEL_LABELS.priority[p]).replace(/^P\d – /, "")}
            </div>
            <div className={cn("mt-1.5 text-2xl font-semibold tabular-nums", p === "p1" && s.openByPriority.p1 ? "text-red-700" : "text-slate-900")}>{s.openByPriority[p]}</div>
          </button>
        ))}
        <button type="button" onClick={() => onPick("kev")} className="rounded-lg border border-slate-200 p-3 text-left transition hover:border-brand-300">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
            <KevBadge /> {t("vp.kevOpen")}
          </div>
          <div className={cn("mt-1.5 text-2xl font-semibold tabular-nums", s.kevOpen ? "text-red-700" : "text-slate-900")}>{s.kevOpen}</div>
        </button>
        <button type="button" onClick={() => onPick("overdue")} className="rounded-lg border border-slate-200 p-3 text-left transition hover:border-brand-300">
          <div className="text-xs font-medium text-slate-600">{t("vr.overdueTile")}</div>
          <div className={cn("mt-1.5 text-2xl font-semibold tabular-nums", s.overdue ? "text-red-700" : "text-slate-900")}>{s.overdue}</div>
          <div className="text-[11px] text-slate-500">{t("vr.slaShort", { p1: s.intel.sla.p1 ?? "—", p2: s.intel.sla.p2 ?? "—", p3: s.intel.sla.p3 ?? "—" })}</div>
        </button>
      </div>
      <p className={cn("border-t border-slate-100 px-4 py-2 text-xs", s.intel.lastError ? "text-amber-800" : "text-slate-500")}>
        {fresh
          ? t("vp.intelState", { kev: s.intel.kevEntries, kevAt: s.intel.kevUpdatedAt ? fmtDate(s.intel.kevUpdatedAt) : "—", epss: s.intel.epssEntries, epssDate: s.intel.epssDate ?? "—" })
          : t("vp.intelNone")}
        {s.intel.lastError && ` · ${t("vp.intelError", { e: s.intel.lastError })}`}
      </p>
      {settings && <IntelModal onClose={() => setSettings(false)} />}
    </Card>
  );
}

/** Správa zdrojů KEV / EPSS: adresy, denní stažení, ruční stažení a nahrání souborů. */
function IntelModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["vuln-intel"], queryFn: api.vulns.intel });
  const [kevUrl, setKevUrl] = useState<string | null>(null);
  const [epssUrl, setEpssUrl] = useState<string | null>(null);
  const [auto, setAuto] = useState<boolean | null>(null);
  const [sla, setSla] = useState<VulnSla | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const done = () => {
    qc.invalidateQueries({ queryKey: ["vuln-intel"] });
    qc.invalidateQueries({ queryKey: ["vuln-summary"] });
    qc.invalidateQueries({ queryKey: ["vulns"] });
    qc.invalidateQueries({ queryKey: ["vuln-fix-plan"] });
  };
  const save = useMutation({ mutationFn: () => api.vulns.saveIntel({ kevUrl: kevUrl ?? undefined, epssUrl: epssUrl ?? undefined, autoRefresh: auto ?? undefined, sla: sla ?? undefined }), onSuccess: done });
  const refresh = useMutation({ mutationFn: api.vulns.refreshIntel, onSuccess: done });
  const upload = useMutation({ mutationFn: (f: File) => api.vulns.uploadIntel(f), onSuccess: done });
  const s = q.data;
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("vp.sources")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || (kevUrl === null && epssUrl === null && auto === null && sla === null)}>
            {t("soc.save")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{t("vp.sourcesHint")}</p>
      {s && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={auto ?? s.autoRefresh} onChange={(e) => setAuto(e.target.checked)} /> {t("vp.auto")}
          </label>
          <Field label={t("vp.kevUrl")}>
            <Input value={kevUrl ?? s.kevUrl} onChange={(e) => setKevUrl(e.target.value)} />
          </Field>
          <Field label={t("vp.epssUrl")}>
            <Input value={epssUrl ?? s.epssUrl} onChange={(e) => setEpssUrl(e.target.value)} />
          </Field>
          <div>
            <div className="mb-1 text-sm font-medium text-slate-700">{t("vr.slaTitle")}</div>
            <p className="mb-2 text-xs text-slate-500">{t("vr.slaHint")}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {VULN_PRIORITIES.map((p) => {
                const cur = (sla ?? s.sla)[p];
                return (
                  <Field key={p} label={t("vr.slaDays", { p: t.lbl(VULN_INTEL_LABELS.priorityShort[p]) })}>
                    <Input type="number" min={1} max={730} value={cur ?? ""} placeholder="—" onChange={(e) => setSla({ ...(sla ?? s.sla), [p]: e.target.value ? Number(e.target.value) : null })} />
                  </Field>
                );
              })}
            </div>
          </div>
          <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {t("vp.state", { kev: s.kevEntries, kevVersion: s.kevVersion ?? "—", kevAt: s.kevUpdatedAt ? fmtDate(s.kevUpdatedAt) : "—", epss: s.epssEntries, epssDate: s.epssDate ?? "—" })}
            {s.lastError && <div className="mt-1 text-amber-800">{s.lastError}</div>}
          </div>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          {refresh.isPending ? t("vp.downloading") : t("vp.downloadNow")}
        </Button>
        <Button variant="secondary" onClick={() => file.current?.click()} disabled={upload.isPending}>
          <Upload size={15} /> {t("vp.upload")}
        </Button>
        <input
          ref={file}
          type="file"
          accept=".json,.csv,.gz"
          className="hidden"
          aria-label={t("vp.upload")}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload.mutate(f);
            e.target.value = "";
          }}
        />
      </div>
      <p className="text-xs text-slate-500">{t("vp.uploadHint")}</p>
      {refresh.data && <p className="text-sm text-slate-700">{t("vp.downloaded", { kev: refresh.data.kev, epss: refresh.data.epss })}</p>}
      {upload.data && <p className="text-sm text-slate-700">{t("vp.uploaded", { kind: upload.data.kind.toUpperCase(), n: upload.data.entries })}</p>}
      <ErrorBox error={q.error ?? save.error ?? refresh.error ?? upload.error} />
    </Modal>
  );
}

/** Plán oprav: balíčky seřazené podle toho, kolik prioritních zranitelností jejich oprava odstraní. */
export function FixPlanCard({ onPackage }: { onPackage: (pkg: string) => void }) {
  const t = useT();
  const can = useCan();
  const me = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["vuln-fix-plan"], queryFn: api.vulns.fixPlan });
  const [all, setAll] = useState(false);
  const risk = useMutation({
    mutationFn: (pkg: string) => api.risks.fromPackage(pkg, me.activeCompanyId ?? undefined),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["vuln-fix-plan"] });
      qc.invalidateQueries({ queryKey: ["risks"] });
      nav({ to: "/risks/$riskId", params: { riskId: r.id } });
    },
  });
  const items = q.data ?? [];
  const shown = all ? items : items.slice(0, 10);
  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader title={t("vp.plan.title")} subtitle={t("vp.plan.subtitle")} action={<ShieldAlert size={16} className="text-slate-400" aria-hidden />} />
      <ErrorBox error={q.error ?? risk.error} />
      {!q.data ? (
        <EmptyState>{t("common.loading")}</EmptyState>
      ) : items.length === 0 ? (
        <EmptyState>{t("vp.plan.empty")}</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">{t("vp.plan.package")}</th>
                <th className="w-56 px-3 py-2">{t("vp.plan.removes")}</th>
                <th className="w-24 px-3 py-2 text-right">{t("vp.plan.assets")}</th>
                <th className="px-3 py-2">{t("vp.plan.top")}</th>
                {can("risks:write") && <th className="w-36 px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((x) => (
                <PlanRow key={x.packageName} x={x} onPackage={onPackage} onRisk={can("risks:write") ? () => risk.mutate(x.packageName) : undefined} busy={risk.isPending} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {items.length > 10 && (
        <button type="button" className="w-full border-t border-slate-100 px-4 py-2 text-xs text-brand-700 hover:bg-slate-50" onClick={() => setAll(!all)}>
          {all ? t("rsk.zobrazitMene") : t("vp.plan.more", { n: items.length - 10 })}
        </button>
      )}
    </Card>
  );
}

function PlanRow({ x, onPackage, onRisk, busy }: { x: VulnFixPlanItem; onPackage: (pkg: string) => void; onRisk?: () => void; busy: boolean }) {
  const t = useT();
  return (
    <tr className="align-top">
      <td className="px-4 py-2.5">
        <button type="button" className="text-left font-medium text-brand-700 hover:underline" onClick={() => onPackage(x.packageName)}>
          {x.packageName}
        </button>
        {x.versions.length > 0 && <div className="text-xs text-slate-500">{x.versions.join(", ")}</div>}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1">
          {VULN_PRIORITIES.filter((p) => x.byPriority[p]).map((p) => (
            <span key={p} className="inline-flex items-center gap-0.5 text-xs">
              <PriorityBadge p={p} /> <span className="tabular-nums">{x.byPriority[p]}</span>
            </span>
          ))}
          {x.kev > 0 && (
            <span className="inline-flex items-center gap-0.5 text-xs">
              <KevBadge /> <span className="tabular-nums">{x.kev}</span>
            </span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-slate-500">{t("vp.plan.cves", { n: x.cves, epss: epssText(x.maxEpss) })}</div>
      </td>
      <td className="px-3 py-2.5 text-right text-xs tabular-nums" title={x.assetNames.join(", ")}>
        {x.assets}
      </td>
      <td className="px-3 py-2.5 text-xs">
        {x.sample.slice(0, 3).map((c) => (
          <div key={c.cveId} className="flex items-center gap-1.5">
            <Link to="/vulnerabilities/cve/$cveId" params={{ cveId: c.cveId }} className="font-mono text-brand-700 hover:underline">
              {c.cveId}
            </Link>
            {c.kev && <KevBadge />}
            {c.epss != null && <span className="text-slate-500">EPSS {epssText(c.epss)}</span>}
          </div>
        ))}
      </td>
      {onRisk && (
        <td className="px-3 py-2.5 text-right">
          {x.unlinked > 0 && (
            <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={onRisk} disabled={busy} title={t("vp.plan.riskHint", { n: x.unlinked })}>
              {t("rsk.zalozitRiziko")}
            </Button>
          )}
        </td>
      )}
    </tr>
  );
}
