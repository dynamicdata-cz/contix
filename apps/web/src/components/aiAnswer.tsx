/**
 * Odpověď AI s citacemi (v0.50, ADR-045): text s odkazy [n] na úryvky dokumentace a záznamy evidencí,
 * seznam zdrojů a jednotný AI vstup na Přehledu (jedno pole – data, dokumentace i záznamy).
 */
import { Badge, Button, Card, Input, type Tone } from "@/components/ui";
import { recordTone } from "@/components/records";
import { api } from "@/lib/api";
import { useCan, useModule } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { RECORD_LABELS, type AiQueryDto, type AiQuerySource } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Flame, Loader2, Send, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";

const sourceTone = (s: AiQuerySource): Tone => (s.kind === "doc" ? "blue" : recordTone[s.kind]);
const sourceLabel = (s: AiQuerySource) => (s.kind === "doc" ? "Dokument" : RECORD_LABELS[s.kind]);

/** Odkaz na cestu v aplikaci včetně případných parametrů (?a=b). */
export function AppLink({ to, className, title, children }: { to: string; className?: string; title?: string; children: ReactNode }) {
  const [path, query] = to.split("?");
  return (
    <Link to={path as never} search={Object.fromEntries(new URLSearchParams(query ?? "")) as never} className={className} title={title}>
      {children}
    </Link>
  );
}

/** Text odpovědi – citace [n] jako odkazy na zdroj. */
export function AiAnswerText({ answer, sources }: { answer: string; sources: AiQuerySource[] }) {
  const t = useT();
  const parts = answer.split(/(\[\d+\])/g);
  return (
    <div className="whitespace-pre-wrap">
      {parts.map((p, i) => {
        const m = p.match(/^\[(\d+)\]$/);
        const src = m ? sources.find((s) => s.n === Number(m[1])) : undefined;
        return src ? (
          <AppLink key={i} to={src.link} className="mx-0.5 rounded bg-brand-100 px-1 text-xs font-semibold text-brand-800 no-underline hover:bg-brand-200" title={`${t.lbl(sourceLabel(src))}: ${src.title}`}>
            {src.n}
          </AppLink>
        ) : (
          <span key={i}>{p}</span>
        );
      })}
    </div>
  );
}

export function AiSourceList({ sources, className }: { sources: AiQuerySource[]; className?: string }) {
  const t = useT();
  if (!sources.length) return null;
  return (
    <ol className={cn("space-y-2 text-sm", className)} aria-label={t("aiq.sources")}>
      {sources.map((s) => (
        <li key={s.n} className="flex gap-2">
          <span className="mt-0.5 h-5 min-w-5 rounded bg-brand-100 px-1 text-center text-xs font-semibold leading-5 text-brand-800">{s.n}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={sourceTone(s)}>{t.lbl(sourceLabel(s))}</Badge>
              <AppLink to={s.link} className="font-medium text-brand-700 hover:underline">
                {s.title}
              </AppLink>
              {s.subtitle && <span className="text-xs text-slate-500">· {s.subtitle}</span>}
            </div>
            {s.snippet && <div className="mt-0.5 line-clamp-2 text-xs text-slate-600">{s.snippet}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Rychlé dotazy podle oprávnění, modulů a zapnutých funkcí (texty se překládají přes t.lbl). */
function useQuickQueries(opts: { overdue: number; docQa: boolean; recordSearch: boolean }) {
  const can = useCan();
  const mod = useModule();
  const list: { q: string; hot?: boolean }[] = [];
  list.push({ q: "Co je po termínu?", hot: opts.overdue > 0 });
  if (mod("incidents") && can("incidents:read")) list.push({ q: "Které incidenty jsou otevřené?" });
  if (mod("risks") && can("risks:read")) list.push({ q: "Jaká rizika jsou nad hranicí akceptovatelnosti a nemají rozhodnutí o zvládání?" });
  if (mod("assets") && mod("vulnerabilities") && can("assets:read")) list.push({ q: "Které kritické zranitelnosti nejsou vyřešené?" });
  if (mod("assets") && can("assets:read")) list.push({ q: "Která kritická aktiva nemají vlastníka?" });
  if (opts.docQa) list.push({ q: "Co říká naše dokumentace o zálohování?" });
  if (opts.recordSearch && mod("incidents") && can("incidents:read")) list.push({ q: "Měli jsme už incident s phishingem?" });
  return list.slice(0, 7);
}

/**
 * Jednotný AI vstup na Přehledu: jedno pole pro dotazy na data, dokumentaci i záznamy.
 * CONTIX dohledá úryvky a záznamy, model zvolí čtecí přehledy; odpověď cituje zdroje s odkazy.
 */
export function AiEntryCard({ overdue = 0, className }: { overdue?: number; className?: string }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["ai", "status"], queryFn: api.ai.status, enabled: can("ai:use"), staleTime: 60_000 });
  const [question, setQuestion] = useState("");
  const [id, setId] = useState<string | null>(null);
  const cur = useQuery({
    queryKey: ["ai", "query", id],
    queryFn: () => api.ai.query(id!),
    enabled: !!id,
    refetchInterval: (q) => ((q.state.data as AiQueryDto | undefined)?.status === "running" ? 2000 : false),
  });
  const ask = useMutation({
    mutationFn: (q: string) => api.ai.ask({ question: q }),
    onSuccess: (r) => {
      setId(r.id);
      qc.setQueryData(["ai", "query", r.id], r);
      qc.invalidateQueries({ queryKey: ["ai", "queries"] });
    },
  });
  const quick = useQuickQueries({ overdue, docQa: !!status.data?.docQa, recordSearch: !!status.data?.recordSearch });
  if (!can("ai:use") || !status.data?.enabled) return null;
  const q = cur.data;
  const running = ask.isPending || q?.status === "running";
  const submit = (text: string) => {
    const v = text.trim();
    if (v.length >= 3 && !running) {
      setQuestion(v);
      ask.mutate(v);
    }
  };
  const scope = [t("aiq.scopeData"), status.data.docQa && t("aiq.scopeDocs"), status.data.recordSearch && t("aiq.scopeRecords")].filter(Boolean).join(" · ");

  return (
    <Card className={cn("overflow-hidden border-violet-200", className)}>
      <form
        className="flex flex-wrap items-center gap-3 bg-gradient-to-r from-violet-50 to-white p-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit(question);
        }}
      >
        <Sparkles size={20} className="text-violet-600" aria-hidden />
        <Input className="min-w-64 flex-1" value={question} maxLength={500} placeholder={t("aiq.placeholder")} aria-label={t("aiq.label")} onChange={(e) => setQuestion(e.target.value)} />
        <Button type="submit" disabled={question.trim().length < 3 || running}>
          {running ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {t("ai.zeptatSe")}
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-1.5 border-t border-violet-100 px-4 py-2.5">
        {quick.map((x) => (
          <button
            key={x.q}
            type="button"
            disabled={running}
            onClick={() => submit(t.lbl(x.q))}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs hover:border-brand-300 hover:text-brand-700 disabled:opacity-50",
              x.hot ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 text-slate-600",
            )}
          >
            {x.hot && <Flame size={12} aria-hidden />} {t.lbl(x.q)}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-400">{scope}</span>
      </div>
      {ask.error && (
        <div className="border-t border-slate-100 px-4 py-3 text-sm text-red-700">{(ask.error as Error).message}</div>
      )}
      {q && (
        <div className="space-y-3 border-t border-slate-100 px-4 py-4" aria-live="polite">
          <div className="text-sm font-medium text-slate-800">{q.question}</div>
          {q.status === "running" ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 size={15} className="animate-spin" /> {t("ai.modelPripravujeOdpovedLokalniModel")}
            </div>
          ) : q.status === "error" ? (
            <div className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {q.error}
            </div>
          ) : (
            <>
              <div className="rounded-md border border-violet-200 bg-violet-50/60 px-4 py-3 text-sm leading-relaxed text-slate-800" data-testid="ai-answer">
                <AiAnswerText answer={q.answer ?? ""} sources={q.sources} />
              </div>
              <AiSourceList sources={q.sources} />
              {q.results.length > 0 && (
                <ul className="flex flex-wrap gap-2 text-xs">
                  {q.results.map((r, i) => (
                    <li key={i} className="rounded-md border border-slate-200 px-2 py-1 text-slate-600">
                      {r.title} {r.error ? <Badge tone="red">{t("ai.chyba")}</Badge> : <span className="tabular-nums text-slate-400">· {r.total ?? 0}</span>}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>
                  {q.model && <>{q.model} · </>}
                  {q.durationMs != null && <>{Math.round(q.durationMs / 1000)} s · </>}
                  {t("aiq.disclaimer")}
                </span>
                <Link to="/ask" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
                  {q.results.length ? t("aiq.openTables") : t("aiq.openHistory")} <ArrowRight size={13} />
                </Link>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
