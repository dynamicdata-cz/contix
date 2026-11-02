import { RelatedRecordsCard } from "@/components/records";
/** Detail zranitelnosti (CVE) a postup odstranění – pevný postup podle OS + AI rozbor (ADR-076). */
import { SeverityBadge } from "@/components/health";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, PageHeader } from "@/components/ui";
import { epssText, KevBadge, PriorityBadge } from "@/components/vulnPriority";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { fmtDate, fmtDay } from "@/lib/utils";
import { OS_FAMILY_LABELS, type Severity, type VulnAdviceDto, type VulnCveDetail } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Check, Copy, ExternalLink, Sparkles, Terminal } from "lucide-react";
import { useState } from "react";

export function VulnCvePage() {
  const t = useT();
  const { cveId } = useParams({ strict: false }) as { cveId: string };
  const q = useQuery({ queryKey: ["vuln-cve", cveId], queryFn: () => api.vulns.cve(cveId) });
  const d = q.data;
  return (
    <>
      <PageHeader
        title={cveId}
        subtitle={t("vc.subtitle")}
        actions={
          <a href={`https://nvd.nist.gov/vuln/detail/${cveId}`} target="_blank" rel="noreferrer">
            <Button variant="secondary">
              NVD <ExternalLink size={14} />
            </Button>
          </a>
        }
      />
      <ErrorBox error={q.error} />
      {!d ? (
        !q.error && <EmptyState>{t("common.loading")}</EmptyState>
      ) : (
        <div className="space-y-6">
          <Overview d={d} />
          <FixCard d={d} />
          <AdviceCard d={d} />
          <OccurrencesCard d={d} />
          <RelatedRecordsCard text={`${cveId}\n${d.description ?? ""}`.slice(0, 2000)} kinds={["incident", "risk", "exception", "cra_finding", "audit_finding"]} />
        </div>
      )}
    </>
  );
}

function Overview({ d }: { d: VulnCveDetail }) {
  const t = useT();
  return (
    <Card className="p-5" data-testid="vuln-overview">
      <div className="flex flex-wrap items-center gap-3">
        <PriorityBadge p={d.priority} />
        <SeverityBadge severity={d.severity as Severity} />
        {d.cvss != null && <Badge tone="slate">CVSS {d.cvss.toFixed(1)}</Badge>}
        {d.kev && <KevBadge ransomware={d.kevRansomware} />}
        {d.epss != null && <Badge tone={d.epss >= 0.1 ? "red" : "slate"}>EPSS {epssText(d.epss)}</Badge>}
        <span className="text-sm text-slate-600">{t("vc.openCount", { n: d.open, all: d.occurrences.length })}</span>
      </div>
      {d.kev && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {t("vc.kevNote", { name: d.kevName ?? d.cveId, added: d.kevDateAdded ? fmtDay(d.kevDateAdded) : "—" })}
          {d.kevDueDate && ` ${t("vc.kevDue", { due: fmtDay(d.kevDueDate) })}`}
        </p>
      )}
      {d.description && <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{d.description}</p>}
      <div className="mt-2 text-xs text-slate-500">
        {d.publishedAt && `${t("vc.published")}: ${fmtDay(d.publishedAt)}`}
        {d.reference && (
          <>
            {" · "}
            {d.reference
              .split(/[\s,]+/)
              .filter((u) => /^https?:\/\//.test(u))
              .slice(0, 5)
              .map((u) => (
                <a key={u} href={u} target="_blank" rel="noreferrer" className="mr-2 text-brand-700 hover:underline">
                  {new URL(u).hostname}
                </a>
              ))}
          </>
        )}
      </div>
    </Card>
  );
}

function CopyCmd({ cmd }: { cmd: string }) {
  const t = useT();
  const [ok, setOk] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100">
      <Terminal size={13} className="mt-0.5 shrink-0 text-slate-400" />
      <code className="flex-1 break-all">{cmd}</code>
      <button
        type="button"
        className="shrink-0 text-slate-400 hover:text-white"
        aria-label={t("vc.copy")}
        title={t("vc.copy")}
        onClick={() => {
          void navigator.clipboard?.writeText(cmd);
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        }}
      >
        {ok ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}

function FixCard({ d }: { d: VulnCveDetail }) {
  const t = useT();
  if (!d.fix.length) return null;
  return (
    <Card className="overflow-hidden" data-testid="vuln-fix">
      <CardHeader title={t("vc.fixTitle")} subtitle={t("vc.fixSubtitle")} />
      <div className="divide-y divide-slate-100">
        {d.fix.map((g) => (
          <div key={`${g.osFamily}|${g.packageName}`} className="space-y-2 px-5 py-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="blue">{t.lbl(OS_FAMILY_LABELS[g.osFamily])}</Badge>
              <span className="font-mono font-medium">{g.packageName || "—"}</span>
              {g.versions.length > 0 && <span className="text-xs text-slate-500">{t("vc.installed", { v: g.versions.join(", ") })}</span>}
              <span className="ml-auto text-xs text-slate-500">{t("vc.assets", { n: g.assets })}</span>
            </div>
            {g.command ? <CopyCmd cmd={g.command} /> : <p className="text-xs text-slate-600">{g.osFamily === "windows" ? t("vc.windowsHint") : t("vc.manualHint")}</p>}
            {g.verify && (
              <div className="text-xs text-slate-500">
                {t("vc.verify")} <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">{g.verify}</code>
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">{t("vc.fixNote")}</p>
    </Card>
  );
}

function List({ title, items, ordered }: { title: string; items: string[]; ordered?: boolean }) {
  if (!items.length) return null;
  const L = ordered ? "ol" : "ul";
  return (
    <div>
      <div className="mb-1 text-sm font-semibold text-slate-800">{title}</div>
      <L className={`${ordered ? "list-decimal" : "list-disc"} space-y-1 pl-5 text-sm text-slate-700`}>
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </L>
    </div>
  );
}

function AdviceCard({ d }: { d: VulnCveDetail }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const gen = useMutation({ mutationFn: () => api.vulns.advice(d.cveId), onSuccess: (a) => qc.setQueryData(["vuln-cve", d.cveId], { ...d, advice: a }) });
  const a: VulnAdviceDto | null = d.advice;
  const allowed = can("ai:use") && d.aiAvailable;
  return (
    <Card className="overflow-hidden" data-testid="vuln-advice">
      <CardHeader
        title={t("vc.aiTitle")}
        subtitle={a ? t("vc.aiMeta", { model: a.model, at: fmtDate(a.generatedAt) }) : t("vc.aiSubtitle")}
        action={
          allowed && (
            <Button variant={a ? "secondary" : "primary"} onClick={() => gen.mutate()} disabled={gen.isPending}>
              <Sparkles size={15} /> {gen.isPending ? t("vc.aiRunning") : a ? t("vc.aiRegenerate") : t("vc.aiGenerate")}
            </Button>
          )
        }
      />
      <ErrorBox error={gen.error} />
      {!a ? (
        <p className="px-5 py-4 text-sm text-slate-500">{allowed ? t("vc.aiEmpty") : d.aiAvailable ? t("vc.aiNoPerm") : t("vc.aiOff")}</p>
      ) : (
        <div className="space-y-4 px-5 py-4">
          <p className="text-sm text-slate-800">{a.summary}</p>
          {a.impact && (
            <div>
              <div className="mb-1 text-sm font-semibold text-slate-800">{t("vc.impact")}</div>
              <p className="text-sm text-slate-700">{a.impact}</p>
            </div>
          )}
          {a.exploitation && (
            <div>
              <div className="mb-1 text-sm font-semibold text-slate-800">{t("vc.exploitation")}</div>
              <p className="text-sm text-slate-700">{a.exploitation}</p>
            </div>
          )}
          <List title={t("vc.remediation")} items={a.remediation} ordered />
          <List title={t("vc.workaround")} items={a.workaround} />
          <List title={t("vc.verification")} items={a.verification} />
          {a.references.length > 0 && (
            <div className="flex flex-wrap gap-3 text-xs">
              {a.references.map((u) => (
                <a key={u} href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                  {u.replace(/^https?:\/\//, "").slice(0, 60)} <ExternalLink size={11} />
                </a>
              ))}
            </div>
          )}
          {a.caveats && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">{a.caveats}</p>}
          <p className="text-xs text-slate-400">{t("vc.aiDisclaimer")}</p>
        </div>
      )}
    </Card>
  );
}

function OccurrencesCard({ d }: { d: VulnCveDetail }) {
  const t = useT();
  return (
    <Card className="overflow-hidden">
      <CardHeader title={t("vc.occTitle")} subtitle={t("vc.occSubtitle")} />
      {d.occurrences.length === 0 ? (
        <EmptyState>{t("vc.occEmpty")}</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">{t("vc.col.asset")}</th>
                <th className="px-3 py-2">{t("vc.col.os")}</th>
                <th className="px-3 py-2">{t("vc.col.package")}</th>
                <th className="px-3 py-2">{t("vc.col.priority")}</th>
                <th className="px-3 py-2">{t("vc.col.due")}</th>
                <th className="px-3 py-2">{t("vc.col.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {d.occurrences.map((o) => (
                <tr key={o.id} className="align-top">
                  <td className="px-4 py-2">
                    <Link to="/assets/$assetId" params={{ assetId: o.assetId }} className="font-medium hover:text-brand-700">
                      {o.assetName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">{o.osName ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {o.packageName || "—"} {o.packageVersion}
                  </td>
                  <td className="px-3 py-2">
                    <PriorityBadge p={o.priority} />
                  </td>
                  <td className={`px-3 py-2 text-xs ${o.overdue ? "font-semibold text-red-700" : "text-slate-600"}`}>{o.due ? fmtDay(o.due) : "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    <Badge tone={o.status === "open" ? "amber" : o.status === "resolved" ? "green" : "slate"}>{t(`vc.status.${o.status}` as "vc.status.open")}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
