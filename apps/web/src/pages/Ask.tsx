import { useT } from "@/lib/i18n";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, PageHeader, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import type { AiQueryDto, AiQueryResult } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Loader2, Send, Sparkles } from "lucide-react";
import { useState } from "react";
import { AiAnswerText, AiSourceList } from "@/components/aiAnswer";

const EXAMPLES = [
  "Která kritická aktiva nemají vlastníka?",
  "Jaká rizika jsou nad hranicí akceptovatelnosti a nemají rozhodnutí o zvládání?",
  "Která zavedená opatření nebyla za poslední rok otestována?",
  "Co je po termínu?",
  "Které požadavky vyhlášky 409 nejsou splněné?",
  "Otevřené incidenty za poslední měsíc",
];

const fmt = (v: string) => new Date(v).toLocaleString("cs-CZ", { dateStyle: "short", timeStyle: "short" });

/** Dotazy v přirozeném jazyce nad daty CONTIX (AI vybere čtecí přehledy, odpověď shrne; tabulky jsou přímo z dat). */
export function AskPage() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["ai", "status"], queryFn: api.ai.status, enabled: can("ai:use"), staleTime: 60_000 });
  const tools = useQuery({ queryKey: ["ai", "tools"], queryFn: api.ai.tools, enabled: can("ai:use") });
  const history = useQuery({
    queryKey: ["ai", "queries"],
    queryFn: api.ai.queries,
    enabled: can("ai:use"),
    refetchInterval: (q) => ((q.state.data as AiQueryDto[] | undefined)?.some((x) => x.status === "running") ? 2500 : false),
  });
  // otázka předaná z rychlého hledání (Ctrl+K) – jen předvyplní, neodešle (v1.06)
  const [question, setQuestion] = useState(() => new URLSearchParams(window.location.search).get("q") ?? "");
  const [selected, setSelected] = useState<string | null>(null);
  const ask = useMutation({
    mutationFn: (q: string) => api.ai.ask({ question: q }),
    onSuccess: (r) => {
      setSelected(r.id);
      setQuestion("");
      qc.invalidateQueries({ queryKey: ["ai", "queries"] });
    },
  });
  const list = history.data ?? [];
  const current = list.find((q) => q.id === selected) ?? list[0];
  const running = list.some((q) => q.status === "running");

  if (!can("ai:use")) return <EmptyState>{t("ai.nemateOpravneniPouzivatAiAsistenta")}</EmptyState>;

  return (
    <>
      <PageHeader title={t("ai.zeptatSeAi")} subtitle={t("ai.dotazVBezneReciNad")} />
      {status.data && !status.data.enabled && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{t("ai.aiAsistentJeVypnutyZapne")}</div>
      )}
      <Card className="mb-6">
        <form
          className="space-y-3 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (question.trim().length >= 3) ask.mutate(question.trim());
          }}
        >
          <Textarea
            rows={2}
            value={question}
            maxLength={500}
            placeholder={t("ai.naprKteraKritickaAktivaMaji")}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (question.trim().length >= 3 && !running) ask.mutate(question.trim());
              }
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((x) => (
                <button key={x} type="button" className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-brand-300 hover:text-brand-700" onClick={() => setQuestion(t.lbl(x))}>
                  {t.lbl(x)}
                </button>
              ))}
            </div>
            <Button type="submit" disabled={question.trim().length < 3 || ask.isPending || running || !status.data?.enabled}>
              {running ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {t("ai.zeptatSe")}
            </Button>
          </div>
          <ErrorBox error={ask.error} />
          {tools.data && (
            <p className="text-xs text-slate-500">
              {t("ai.dostupnePrehledyPodleVasichOpravneni", { p: tools.data.map((tx) => tx.title).join(" · ") })}
            </p>
          )}
        </form>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div>{current ? <QueryView q={current} /> : <EmptyState>{history.isLoading ? t("common.loading") : t("ai.zatimZadnyDotaz")}</EmptyState>}</div>
        <Card className="h-fit overflow-hidden">
          <CardHeader title={t("ai.mojeDotazy")} subtitle={t("ai.poslednich20")} />
          <ul className="divide-y divide-slate-100 text-sm">
            {list.map((q) => (
              <li key={q.id}>
                <button className={`w-full px-4 py-2.5 text-left hover:bg-slate-50 ${current?.id === q.id ? "bg-brand-50" : ""}`} onClick={() => setSelected(q.id)}>
                  <div className="line-clamp-2">{q.question}</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {fmt(q.createdAt)} {q.status === "running" && t("ai.bezi2")} {q.status === "error" && "· chyba"}
                  </div>
                </button>
              </li>
            ))}
            {!list.length && <li className="px-4 py-3 text-slate-500">—</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}

function QueryView({ q }: { q: AiQueryDto }) {
  const t = useT();
  return (
    <div className="space-y-4">
      <Card>
        <div className="space-y-3 p-5">
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
            <div className="rounded-md border border-violet-200 bg-violet-50/60 px-4 py-3 text-sm leading-relaxed text-slate-800">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-violet-700">
                <Sparkles size={13} /> {t("ai.odpovedAi")} {q.model && <span className="font-normal text-violet-500">· {q.model}</span>}
                {q.durationMs != null && <span className="font-normal text-violet-500">· {Math.round(q.durationMs / 1000)} s</span>}
              </div>
              <AiAnswerText answer={q.answer ?? ""} sources={q.sources ?? []} />
              <p className="mt-2 text-xs text-slate-500">{t("ai.odpovedJeShrnutiModeluZavazna")}</p>
            </div>
          )}
          {q.status === "done" && <AiSourceList sources={q.sources ?? []} className="pt-1" />}
        </div>
      </Card>
      {q.results.map((r, i) => (
        <ResultTable key={i} r={r} />
      ))}
    </div>
  );
}

function ResultTable({ r }: { r: AiQueryResult }) {
  const t = useT();
  const args = Object.entries(r.args);
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={r.title}
        subtitle={args.length ? args.map(([k, v]) => `${k}: ${String(v)}`).join(" · ") : "bez filtru"}
        action={r.error ? <Badge tone="red">{t("ai.chyba")}</Badge> : <Badge tone="slate">{t("ai.zaznamu", { total: r.total })}</Badge>}
      />
      {r.error ? (
        <p className="px-5 py-3 text-sm text-red-700">{r.error}</p>
      ) : r.note ? (
        <p className="px-5 py-3 text-sm text-slate-600">{r.note}</p>
      ) : !r.rows?.length ? (
        <p className="px-5 py-3 text-sm text-slate-500">{t("ai.zadneZaznamy")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {r.columns!.map((c) => (
                  <th key={c} className="px-4 py-2">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {r.rows.map((row, i) => (
                <tr key={i}>
                  {row.cells.map((c, j) => (
                    <td key={j} className="px-4 py-2">
                      {j === 0 && row.link ? (
                        <Link to={row.link.split("?")[0] as never} search={Object.fromEntries(new URLSearchParams(row.link.split("?")[1] ?? "")) as never} className="text-brand-700 hover:underline">
                          {String(c ?? "—")}
                        </Link>
                      ) : (
                        String(c ?? "—")
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {(r.total ?? 0) > r.rows.length && <p className="px-4 py-2 text-xs text-slate-500">{t("ai.zobrazenoPrvnichZ", { length: r.rows.length, total: r.total })}</p>}
        </div>
      )}
    </Card>
  );
}
