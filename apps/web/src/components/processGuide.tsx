/**
 * Postup krok za krokem (v1.42, ADR-139): panel „Jak postupovat“ na stránce modulu. Kroky a jejich stav počítá
 * server z dat (`GET /api/guides/:id`, `evaluateGuide`); sbalení si pamatuje prohlížeč. Bez oprávnění / modulu se nezobrazí.
 */
import { PositionSelect } from "@/components/pickers";
import { Badge, Card } from "@/components/ui";
import { toast } from "@/components/ui/overlay";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { GuideDto } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, ChevronDown, UserRound } from "lucide-react";
import { useState } from "react";

export function useStoredFlag(key: string, def: boolean): [boolean, (v: boolean) => void] {
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

/** Texty kroku průvodce (i18n `gd.<průvodce>.<krok>.*`). */
export function useGuideText() {
  const t = useT();
  return {
    title: (g: string) => t.dyn(`gd.${g}.title`, g),
    step: (g: string, s: string) => t.dyn(`gd.${g}.${s}.title`, s),
    hint: (g: string, s: string) => t.dyn(`gd.${g}.${s}.hint`, ""),
    todo: (g: string, s: string, n: number) => t.dyn(`gd.${g}.${s}.todo`, String(n), { n }),
  };
}

export function stepStatus(t: ReturnType<typeof useT>, gt: ReturnType<typeof useGuideText>, g: GuideDto, s: GuideDto["steps"][number]) {
  return s.state === "done" ? t("gd.done") : s.state === "waiting" ? t("gd.waiting") : gt.todo(g.id, s.key, s.count);
}

export function ProcessGuide({ id }: { id: string }) {
  const t = useT();
  const gt = useGuideText();
  const q = useQuery({ queryKey: ["guides", id], queryFn: () => api.guides.get(id), retry: false, staleTime: 30_000 });
  const [open, setOpen] = useStoredFlag(`contix.guide.${id}`, true);
  const qc = useQueryClient();
  const [editOwner, setEditOwner] = useState(false);
  const owner = useMutation({
    mutationFn: (positionId: string | null) => api.guides.setOwner(id, positionId),
    onSuccess: (d) => {
      qc.setQueryData(["guides", id], d);
      qc.invalidateQueries({ queryKey: ["obligations"] });
      setEditOwner(false);
      toast(t("gd.owner.saved"));
    },
    onError: (e) => toast((e as Error).message, "error"),
  });
  const g = q.data;
  if (!g) return null;
  const done = g.steps.filter((s) => s.state === "done").length;
  const next = g.steps.find((s) => s.key === g.next);
  return (
    <Card className="mb-4" data-testid={`guide-${id}`}>
      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
          <ChevronDown size={16} className={cn("shrink-0 text-slate-400 transition", !open && "-rotate-90")} />
          <span className="text-sm font-semibold text-slate-900">{t("gd.howTo")}</span>
          <span className="text-xs tabular-nums text-slate-500">{t("gd.progress", { d: done, n: g.steps.length })}</span>
          <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-slate-100 sm:block" aria-hidden>
            <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${g.progress}%` }} />
          </span>
        </button>
        <span className="flex items-center gap-1.5 text-xs text-slate-600" data-testid="guide-owner">
          <UserRound size={14} className="text-slate-400" />
          {editOwner ? (
            <PositionSelect className="w-56 py-1 text-xs" value={g.owner?.positionId ?? null} emptyLabel={t("gd.owner.none")} ariaLabel={t("gd.owner.label")} onChange={(v) => owner.mutate(v)} disabled={owner.isPending} />
          ) : (
            <>
              <span title={t("gd.owner.hint")}>{g.owner ? t("gd.owner.is", { name: g.owner.name }) : t("gd.owner.unset")}</span>
              {g.canEdit && (
                <button type="button" className="text-brand-700 hover:underline" onClick={() => setEditOwner(true)}>
                  {g.owner ? t("gd.owner.change") : t("gd.owner.set")}
                </button>
              )}
            </>
          )}
        </span>
        {next ? (
          <Link to={next.path as never} className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700">
            {t("gd.next", { s: gt.step(g.id, next.key) })} <ArrowRight size={14} />
          </Link>
        ) : (
          <Badge tone="green">{t("gd.allDone")}</Badge>
        )}
      </div>
      {open && (
        <ol className={cn("grid gap-2 border-t border-slate-100 px-5 py-3 sm:grid-cols-2", g.steps.length > 6 ? "lg:grid-cols-4" : g.steps.length > 4 ? "lg:grid-cols-3 xl:grid-cols-6" : "lg:grid-cols-4")}>
          {g.steps.map((s, i) => {
            const cur = g.next === s.key;
            return (
              <li key={s.key}>
                <Link
                  to={s.path as never}
                  aria-current={cur ? "step" : undefined}
                  className={cn("flex h-full items-start gap-2.5 rounded-lg border px-3 py-2 transition hover:bg-slate-50", cur ? "border-brand-400 ring-2 ring-brand-100" : "border-slate-200")}
                  data-testid={`guide-step-${s.key}`}
                >
                  <span className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold", s.state === "done" ? "bg-emerald-100 text-emerald-700" : cur ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600")}>
                    {s.state === "done" ? <Check size={14} /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-900">{gt.step(g.id, s.key)}</span>
                    <span className="block text-xs text-slate-500">{gt.hint(g.id, s.key)}</span>
                    {!!s.refs?.length && <span className="mt-0.5 block font-mono text-[10px] text-slate-400">{s.refs.join(" · ")}</span>}
                    <span className={cn("mt-1 block text-xs font-medium", s.state === "done" ? "text-emerald-700" : s.state === "waiting" ? "text-slate-500" : "text-amber-800")}>{stepStatus(t, gt, g, s)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
