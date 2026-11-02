/** Podobné záznamy (v0.49, ADR-044) – nejbližší rizika, zranitelnosti, incidenty a výjimky podle významu (vektory). */
import { Badge, Card, CardHeader, EmptyState, ErrorBox, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { RECORD_LABELS, type RecordHit, type RecordKind } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";

export const recordTone: Record<RecordKind, Tone> = { risk: "amber", vulnerability: "red", incident: "violet", exception: "slate", audit_finding: "blue", ai_system: "green", cra_finding: "red", control: "green", asset: "blue", process: "violet", supplier: "amber", legal_review: "slate", qa_answer: "blue", knowledge: "violet" };

export function RecordHitRow({ h, showScore = true }: { h: RecordHit; showScore?: boolean }) {
  const t = useT();
  return (
    <li className="px-5 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={recordTone[h.kind]}>{t.lbl(RECORD_LABELS[h.kind])}</Badge>
        <Link to={h.link as never} className="min-w-0 flex-1 font-medium hover:text-brand-700">
          {h.title}
        </Link>
        {showScore && <span className="text-xs tabular-nums text-slate-400" title={t("rec.scoreHint")}>{Math.round(h.score * 100)} %</span>}
      </div>
      {h.snippet && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{h.snippet}</p>}
    </li>
  );
}

/** Karta na detailu záznamu; nezobrazí se, když index není zapnutý nebo záznam ještě nemá vektor. */
export function SimilarRecordsCard({ kind, id, className }: { kind: RecordKind; id: string; className?: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ["records", "similar", kind, id], queryFn: () => api.records.similar(kind, id), staleTime: 60_000, retry: false });
  if (q.isError) return <ErrorBox error={q.error} />;
  if (!q.data?.indexed) return null;
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader title={t("rec.similarTitle")} subtitle={t("rec.similarSubtitle")} action={<Sparkles size={16} className="text-slate-400" aria-hidden />} />
      {q.data.hits.length === 0 ? (
        <EmptyState>{t("rec.similarNone")}</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {q.data.hits.map((h) => (
            <RecordHitRow key={`${h.kind}:${h.refId}`} h={h} />
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Související záznamy k libovolnému textu (varování, CVE, popis) – v0.99. Bez zapnutých vektorů a bez shod se nezobrazí. */
export function RelatedRecordsCard({ text, kinds, exclude, title, className }: { text: string; kinds?: RecordKind[]; exclude?: { kind: RecordKind; id: string }; title?: string; className?: string }) {
  const t = useT();
  const can = useCan();
  const enabled = text.trim().length >= 3 && READ_ANY.some((p) => can(p));
  const q = useQuery({ queryKey: ["records", "related", text, kinds?.join(","), exclude?.id], queryFn: () => api.records.related(text, kinds, exclude), enabled, staleTime: 60_000, retry: false });
  if (!enabled || q.isError || !q.data?.hits.length) return null;
  return (
    <Card className={cn("overflow-hidden", className)} data-testid="related-records">
      <CardHeader title={title ?? t("rec.relatedTitle")} subtitle={q.data.mode === "semantic" ? t("rec.relatedSubtitle") : t("rec.relatedKeyword")} action={<Sparkles size={16} className="text-slate-400" aria-hidden />} />
      <ul className="divide-y divide-slate-100">
        {q.data.hits.map((h) => (
          <RecordHitRow key={`${h.kind}:${h.refId}`} h={h} />
        ))}
      </ul>
    </Card>
  );
}
const READ_ANY = ["risks:read", "assets:read", "incidents:read", "audits:read", "aiact:read", "cra:read"] as const;
