/**
 * Příprava na audit (v1.45, ADR-142): oddíly zvoleného předpisu – shoda požadavků (pokrytí předpisu), opatření,
 * dokumenty, mezery a kroky průvodců k dokončení; export do Wordu a k tisku. Vše z dat, nic se neukládá.
 */
import { useGuideText } from "@/components/processGuide";
import { Badge, Card, EmptyState, ErrorBox, Facts, PageHeader, Select, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useProfile } from "@/lib/regime";
import { useT } from "@/lib/i18n";
import { useUrlParam } from "@/lib/urlState";
import { cn } from "@/lib/utils";
import { AUDIT_FRAMEWORKS, COVERAGE_LABELS, FRAMEWORKS, auditSectionState, type AuditFramework } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download, FileText, Package } from "lucide-react";

const stateTone: Record<"ready" | "partial" | "missing", Tone> = { ready: "green", partial: "amber", missing: "red" };

export function AuditReadinessPage() {
  const t = useT();
  const gt = useGuideText();
  const profile = useProfile();
  // výchozí předpis podle regulatorního profilu společnosti (ADR-080)
  const def = ((AUDIT_FRAMEWORKS as readonly string[]).includes(profile.defaultFramework) ? profile.defaultFramework : "nis2") as AuditFramework;
  const [fwParam, setFw] = useUrlParam("framework");
  const fw = ((AUDIT_FRAMEWORKS as readonly string[]).includes(fwParam ?? "") ? fwParam : def) as AuditFramework;
  const q = useQuery({ queryKey: ["guides", "audit", fw], queryFn: () => api.guides.audit(fw) });
  const d = q.data;
  return (
    <>
      <PageHeader
        title={t("gd.audit.title")}
        subtitle={t("gd.audit.subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select className="w-auto" value={fw} onChange={(e) => setFw(e.target.value)} aria-label={t("gd.audit.framework")}>
              {AUDIT_FRAMEWORKS.map((f) => (
                <option key={f} value={f}>
                  {FRAMEWORKS.find((x) => x.id === f)?.shortName ?? f}
                </option>
              ))}
            </Select>
            <a href={api.guides.auditReportUrl(fw, "docx")} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
              <Download size={16} /> Word
            </a>
            <a href={api.guides.auditReportUrl(fw, "zip")} title={t("gd.audit.zipHint")} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Package size={16} /> {t("gd.audit.zip")}
            </a>
            <a href={api.guides.auditReportUrl(fw, "html")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <FileText size={16} /> {t("gd.audit.print")}
            </a>
          </div>
        }
      />
      <ErrorBox error={q.error} />
      {!d ? (
        <Card>
          <EmptyState>{t("common.loading")}</EmptyState>
        </Card>
      ) : (
        <>
          <Facts
            className="mb-4"
            items={[
              { label: t("gd.audit.readiness"), value: d.summary.readiness == null ? "–" : `${d.summary.readiness} %` },
              { label: t("gd.audit.sectionsReady"), value: `${d.summary.ready} / ${d.summary.sections}` },
              { label: t("gd.audit.stepsTodo"), value: d.summary.stepsTodo, tone: d.summary.stepsTodo ? "amber" : undefined },
            ]}
          />
          <p className="mb-4 text-sm text-slate-500">{t("gd.audit.note")}</p>
          <div className="space-y-3" data-testid="audit-sections">
            {d.sections.map((s) => {
              const st = auditSectionState(s);
              const todo = s.steps.filter((x) => x.state === "todo");
              return (
                <Card key={s.section} className="p-4" data-testid={`audit-${s.section}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-slate-500">{s.section}</span>
                    <h3 className="min-w-0 flex-1 font-semibold text-slate-900">{s.title}</h3>
                    <Badge tone={stateTone[st]}>{t(`gd.audit.state.${st}`)}</Badge>
                    <span className="w-14 text-right text-sm font-semibold tabular-nums">{s.readiness == null ? "–" : `${s.readiness} %`}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                    <div className={cn("h-full rounded-full", st === "ready" ? "bg-emerald-500" : st === "partial" ? "bg-amber-500" : "bg-red-500")} style={{ width: `${s.readiness ?? 0}%` }} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                    <span>{t("gd.audit.reqs", { a: s.applicable, c: s.compliant, p: s.partial, n: s.nonCompliant, u: s.unassessed })}</span>
                    <span>{t("gd.audit.ctlDocs", { c: s.controls, d: s.docs })}</span>
                    {Object.entries(s.gaps).map(([k, n]) => (
                      <span key={k} className="text-amber-800">
                        {t.lbl(COVERAGE_LABELS.gap[k as keyof typeof COVERAGE_LABELS.gap])}: {n}
                      </span>
                    ))}
                  </div>
                  {todo.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {todo.map((x) => (
                        <li key={`${x.guide}.${x.key}`}>
                          <Link to={x.path as never} className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-900 hover:bg-amber-100">
                            {gt.step(x.guide, x.key)} · {gt.todo(x.guide, x.key, x.count)}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
