/**
 * Dokumentace navázaná na záznam (v0.31) – karta na detailu procesu, aktiva, rizika, dodavatele, opatření.
 * Vazba se nastavuje na kartě dokumentu (Správa dokumentace → dokument → Vazby dokumentu).
 */
import { useT } from "@/lib/i18n";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useModule } from "@/lib/auth";
import { POLICY_LABELS, type PolicyLinkKind } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

export function LinkedDocsCard({ kind, id, className }: { kind: PolicyLinkKind; id: string; className?: string }) {
  const t = useT();
  const can = useCan();
  const mod = useModule();
  const enabled = mod("policies") && can("policies:read");
  const q = useQuery({ queryKey: ["policies", "linked", kind, id], queryFn: () => api.policies.linked(kind, id), enabled });
  if (!enabled) return null;
  return (
    <Card className={className}>
      <CardHeader title={t("doc.dokumentace")} subtitle={t("doc.ridiciDokumentyNavazaneNaTento")} />
      {(q.data ?? []).length === 0 ? (
        <EmptyState>{q.isLoading ? t("common.loading") : t("doc.zadnyNavazanyDokument")}</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {q.data!.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-5 py-2 text-sm">
              <Link to="/policies/$policyId" params={{ policyId: d.id }} className="flex-1 hover:text-brand-700">
                {d.code && <span className="mr-1.5 text-slate-500">{d.code}</span>}
                {d.title}
              </Link>
              <span className="text-xs text-slate-500">{t.lbl(POLICY_LABELS.type[d.docType])}</span>
              {d.currentVersion ? <Badge tone="green">v{d.currentVersion}</Badge> : <Badge tone="amber">{t.lbl(POLICY_LABELS.status[d.status])}</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Kompaktní výpis navázaných dokumentů (např. v posouzení požadavku v prohlášení o aplikovatelnosti). */
export function LinkedDocsInline({ kind, id }: { kind: PolicyLinkKind; id: string }) {
  const t = useT();
  const can = useCan();
  const mod = useModule();
  const enabled = mod("policies") && can("policies:read");
  const q = useQuery({ queryKey: ["policies", "linked", kind, id], queryFn: () => api.policies.linked(kind, id), enabled });
  if (!enabled) return null;
  return (
    <div>
      <div className="mb-1 text-sm font-medium text-slate-700">{t("doc.navazanaDokumentace")}</div>
      {(q.data ?? []).length === 0 ? (
        <p className="text-sm text-slate-500">{q.isLoading ? t("common.loading") : t("doc.zadnaPozadavekNavazeteNaKarte")}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {q.data!.map((d) => (
            <Link key={d.id} to="/policies/$policyId" params={{ policyId: d.id }} className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-xs">
              {d.code} {d.title} {d.currentVersion ? <span className="text-emerald-700">v{d.currentVersion}</span> : <span className="text-amber-700">{t.lbl(POLICY_LABELS.status[d.status])}</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
