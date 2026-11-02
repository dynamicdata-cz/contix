import { Card, CardHeader, EmptyState } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { LINK_LABELS, type LinkTarget } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

const PREVIEW = 5;

/**
 * Zpětné vazby záznamu (v1.05, ADR-101): které incidenty, změny, plány, AI systémy, audity… na tento záznam odkazují.
 * Skupiny i položky jen podle oprávnění uživatele (filtruje API); prázdná karta se skryje.
 */
export function LinkedRecordsCard({ target, id, className }: { target: LinkTarget; id: string; className?: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ["links", target, id], queryFn: () => api.links(target, id), retry: false });
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = q.data?.groups ?? [];
  if (q.isError || (!q.isLoading && groups.length === 0)) return null;
  return (
    <Card className={className} data-testid="linked-records">
      <CardHeader title={t("links.title")} subtitle={t("links.subtitle")} />
      {q.isLoading ? (
        <EmptyState>{t("common.loading")}</EmptyState>
      ) : (
        <div className="divide-y divide-slate-100">
          {groups.map((g) => {
            const all = !!open[g.kind];
            const shown = all ? g.items : g.items.slice(0, PREVIEW);
            return (
              <section key={g.kind} className="px-5 py-3">
                <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t.lbl(LINK_LABELS.kind[g.kind])}
                  <span className="rounded-full bg-slate-100 px-1.5 text-[11px] font-medium text-slate-600">{g.items.length}</span>
                </h3>
                <ul className="space-y-1">
                  {shown.map((x) => (
                    <li key={x.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <Link to={x.link} className="text-slate-800 hover:text-brand-700 hover:underline">
                        {x.label}
                      </Link>
                      {x.sub && <span className="text-xs text-slate-500">{x.sub}</span>}
                    </li>
                  ))}
                </ul>
                {g.items.length > PREVIEW && (
                  <button type="button" className="mt-1.5 inline-flex items-center gap-1 text-xs text-brand-700 hover:underline" onClick={() => setOpen({ ...open, [g.kind]: !all })} aria-expanded={all}>
                    {all ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    {all ? t("links.less") : t("links.more", { n: g.items.length - PREVIEW })}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      )}
    </Card>
  );
}
