/**
 * Kvalita dat (v1.70, ADR-163): slabiny v evidenci na jednom místě – aktiva bez vlastníka / garanta, rizika
 * a opatření bez odpovědné funkce, nálezy bez aktiva… Odpovědnost lze nastavit hromadně vybraným položkám.
 * Vývoj skóre z měsíčních snímků trendů; týdenní souhrn posílá osobám jejich chybějící údaje (v1.71, ADR-164).
 */
import { PositionSelect, UnitSelect, UserSelect } from "@/components/pickers";
import { Badge, Button, Card, EmptyState, ErrorBox, PageHeader, Select, type Tone } from "@/components/ui";
import { toast } from "@/components/ui/overlay";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { QUALITY_LABELS, QUALITY_META, type QualityCheckDto } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { ChevronRight, CircleCheck } from "lucide-react";
import { useState } from "react";

const wTone: Record<"high" | "medium" | "low", Tone> = { high: "red", medium: "amber", low: "slate" };

export function QualityPage() {
  const t = useT();
  const q = useQuery({ queryKey: ["quality"], queryFn: api.quality.get });
  const d = q.data;
  const bad = (d?.checks ?? []).filter((c) => c.count > 0);
  const ok = (d?.checks ?? []).filter((c) => c.count === 0);
  return (
    <>
      <PageHeader title={t("qa.title")} subtitle={t("qa.subtitle")} />
      <ErrorBox error={q.error} />
      {!d ? (
        <EmptyState>{t("common.loading")}</EmptyState>
      ) : (
        <>
          <Card className="mb-6 flex flex-wrap items-center gap-6 p-5" data-testid="qa-score">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("qa.score")}</div>
              <div className={cn("text-3xl font-semibold", (d.score ?? 0) >= 80 ? "text-emerald-700" : (d.score ?? 0) >= 50 ? "text-amber-700" : "text-red-700")}>{d.score == null ? "—" : `${d.score} %`}</div>
            </div>
            <p className="max-w-xl text-sm text-slate-600">{t("qa.scoreHint", { bad: bad.length, total: d.checks.length })}</p>
            {d.history && d.history.length > 0 && (
              <div className="ml-auto" data-testid="qa-history">
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{t("qa.history")}</div>
                <div className="flex items-end gap-1.5" role="img" aria-label={t("qa.historyLabel", { list: d.history.map((h) => `${h.period}: ${h.score ?? "—"} %`).join(", ") })}>
                  {d.history.map((h) => (
                    <div key={h.period} className="flex flex-col items-center gap-0.5" title={t("qa.historyPoint", { period: h.period, score: h.score ?? "—", issues: h.issues ?? "—" })}>
                      <div className="flex h-12 w-5 items-end rounded-sm bg-slate-100">
                        <div className={cn("w-full rounded-sm", (h.score ?? 0) >= 80 ? "bg-emerald-500" : (h.score ?? 0) >= 50 ? "bg-amber-500" : "bg-red-500")} style={{ height: `${Math.max(4, h.score ?? 0)}%` }} />
                      </div>
                      <span className="text-[10px] tabular-nums text-slate-500">{h.period.slice(5)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
          <div className="space-y-3">
            {bad.map((c) => (
              <CheckCard key={c.key} c={c} />
            ))}
          </div>
          {ok.length > 0 && (
            <Card className="mt-6 p-5">
              <p className="mb-2 text-sm font-medium text-slate-700">{t("qa.ok")}</p>
              <ul className="grid gap-1 text-sm text-slate-600 sm:grid-cols-2">
                {ok.map((c) => (
                  <li key={c.key} className="flex items-center gap-2">
                    <CircleCheck size={15} className="text-emerald-600" /> {t.lbl(QUALITY_LABELS[c.key])}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </>
  );
}

function CheckCard({ c }: { c: QualityCheckDto }) {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const m = QUALITY_META[c.key];
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [userId, setUserId] = useState("");
  const [positionId, setPositionId] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const companies = new Set(c.items.filter((i) => sel.includes(i.id)).map((i) => i.companyId));
  const fix = useMutation({
    mutationFn: () =>
      api.quality.fix({ check: c.key, ids: sel, ...(m.fix === "position" ? { positionId: positionId! } : m.fix === "unit" ? { unitId: unitId! } : m.fix === "normalize" ? {} : { userId }) }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["quality"] });
      setSel([]);
      toast(t("qa.fixed", { n: r.updated }));
    },
  });
  const go = (href: string) => (e: React.MouseEvent) => (e.preventDefault(), router.history.push(href));
  return (
    <Card className="overflow-hidden" data-testid={`qa-${c.key}`}>
      <button type="button" className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-slate-50" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronRight size={16} className={cn("shrink-0 text-slate-400 transition-transform", open && "rotate-90")} />
        <span className="flex-1 font-medium text-slate-800">{t.lbl(QUALITY_LABELS[c.key])}</span>
        <Badge tone={wTone[m.weight]}>{c.count}</Badge>
      </button>
      {open && (
        <div className="border-t border-slate-100">
          {c.canFix && (
            <div className="flex flex-wrap items-center gap-2 bg-slate-50/60 px-5 py-2.5 text-sm">
              <span className="text-slate-600">{t("qa.fixSelected", { n: sel.length })}</span>
              {m.fix === "normalize" ? (
                <span className="text-xs text-slate-600">{t("qa.normalizeHint")}</span>
              ) : m.fix === "unit" ? (
                <UnitSelect className="w-64" value={unitId} onChange={setUnitId} ariaLabel={t("ast.ownerUnit")} emptyLabel={t("qa.pickUnit")} />
              ) : m.fix === "position" ? (
                <PositionSelect className="w-64" value={positionId} onChange={setPositionId} ariaLabel={t("qa.position")} />
              ) : (
                <UserSelect value={(userId) || null} onChange={(v) => setUserId((v ?? ""))} ariaLabel={t("qa.person")} className="w-64" emptyLabel={t("qa.pickPerson")} />
              )}
              <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={!sel.length || fix.isPending || (m.fix === "position" ? !positionId : m.fix === "unit" ? !unitId : m.fix === "normalize" ? false : !userId)} onClick={() => fix.mutate()} data-testid="qa-fix">
                {t("qa.apply")}
              </Button>
              {(m.fix === "position" || m.fix === "unit") && companies.size > 1 && <span className="text-xs text-amber-700">{t("qa.oneCompany")}</span>}
              <ErrorBox error={fix.error} />
            </div>
          )}
          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto text-sm">
            {c.items.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-5 py-2">
                {c.canFix && <input type="checkbox" className="h-3.5 w-3.5 rounded border-slate-300" checked={sel.includes(i.id)} onChange={(e) => setSel(e.target.checked ? [...sel, i.id] : sel.filter((x) => x !== i.id))} aria-label={`${t("qa.pick")}: ${i.label}`} />}
                <a href={i.link} onClick={go(i.link)} className="hover:text-brand-700">
                  {i.label}
                </a>
              </li>
            ))}
          </ul>
          {c.count > c.items.length && <p className="px-5 py-2 text-xs text-slate-500">{t("qa.more", { n: c.count - c.items.length })}</p>}
          {c.canFix && (
            <div className="px-5 pb-3">
              <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => setSel(sel.length ? [] : c.items.map((i) => i.id))}>
                {sel.length ? t("qa.none") : t("qa.all")}
              </button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
