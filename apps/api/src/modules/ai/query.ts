import { MAX_QUERY_CALLS, RECORD_LABELS, citedSources, extractJson, parseQueryPlan, type AiQueryDto, type AiQueryResult, type AiQuerySource, type AiQueryStatus } from "@contix/shared";
import { eq } from "drizzle-orm";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { aiQueries } from "../../db/schema";
import type { FetchLike } from "../discovery/connectors/wazuh";
import type { ChatMessage } from "./provider";
import { clientFor, getAiSettings } from "./service";
import { runTool, toolSchema, toolsFor, type ToolCtx } from "./tools";

/* ============================================================
 * Dotaz v přirozeném jazyce (ADR-021): 1) model zvolí nástroje z katalogu (plán),
 * 2) CONTIX je spustí s oprávněními a rozsahem uživatele (čtení), 3) model shrne výsledky.
 * Model nikdy nevidí víc dat, než uživatel smí, a nemá žádný zapisovací nástroj.
 * ============================================================ */

/** Sloupce, které mohou obsahovat jména osob – modelu se neposílají (uživatel je v tabulce vidí). */
const PERSONAL_COLUMNS = new Set(["Vlastník"]);
const ROWS_FOR_MODEL = 30;

/** Nalezený úryvek / záznam včetně plného textu pro model (uživateli jde bez `text`). */
export type RetrievedSource = AiQuerySource & { text: string };
const sourceLabel = (s: AiQuerySource) => (s.kind === "doc" ? "Dokument" : RECORD_LABELS[s.kind]);
const sourceHead = (s: AiQuerySource) => `[${s.n}] ${sourceLabel(s)} – ${s.title}${s.subtitle ? ` (${s.subtitle})` : ""}`;

export function planMessages(question: string, ctx: Pick<ToolCtx, "companyIds" | "byCompany" | "enabledModules">, instructions: string | null, sources: AiQuerySource[] = []): ChatMessage[] {
  const catalog = toolsFor(ctx).map((t) => ({ tool: t.name, description: t.description, args: toolSchema(t).properties ?? {} }));
  return [
    {
      role: "system",
      content: [
        "Jsi asistent GRC aplikace CONTIX (kybernetická bezpečnost, NIS2 / zákon o kybernetické bezpečnosti, ISO 27001, GDPR).",
        `Uživatel se ptá na data v aplikaci. Vyber 1 až ${MAX_QUERY_CALLS} nástroje z katalogu a jejich parametry, které na dotaz odpoví.`,
        "Používej jen nástroje a parametry z katalogu; parametry, které nepotřebuješ, vynech.",
        'Odpověz POUZE JSON objektem: {"calls":[{"tool":"<název>","args":{…}}]}.',
        'Pokud se dotaz netýká dat v aplikaci, vrať {"calls":[],"reply":"<krátká odpověď česky>"}.',
        sources.length
          ? "K dotazu byly navíc nalezeny úryvky z dokumentace a záznamy evidencí (seznam níže; odpověď z nich připraví další krok). Pokud na dotaz odpovídají samy, nástroje nevolej a vrať {\"calls\":[]}.\nNalezené úryvky:\n" +
            sources.map(sourceHead).join("\n")
          : "",
        `Dnešní datum: ${new Date().toISOString().slice(0, 10)}.`,
        instructions ? `Pokyny organizace: ${instructions}` : "",
        "Katalog nástrojů:",
        JSON.stringify(catalog),
      ]
        .filter(Boolean)
        .join("\n"),
    },
    { role: "user", content: question },
  ];
}

export function answerMessages(question: string, results: AiQueryResult[], instructions: string | null, sources: RetrievedSource[] = []): ChatMessage[] {
  const data = results.map((r) => {
    if (r.error) return { nástroj: r.title, chyba: r.error };
    const keep = (r.columns ?? []).map((c, i) => (PERSONAL_COLUMNS.has(c) ? -1 : i)).filter((i) => i >= 0);
    return {
      nástroj: r.title,
      parametry: r.args,
      celkem: r.total,
      ...(r.note ? { poznámka: r.note } : {}),
      sloupce: keep.map((i) => r.columns![i]),
      řádky: (r.rows ?? []).slice(0, ROWS_FOR_MODEL).map((x) => keep.map((i) => x.cells[i])),
    };
  });
  return [
    {
      role: "system",
      content: [
        "Jsi asistent GRC aplikace CONTIX. Odpověz česky, věcně a stručně (nejvýš 8 vět nebo krátký seznam).",
        "Vycházej VÝHRADNĚ z dodaných výsledků; nic nevymýšlej. Uveď počty (pole „celkem“). Pokud výsledky na dotaz neodpovídají nebo jsou prázdné, řekni to.",
        "Uživatel vidí kompletní tabulky s odkazy pod tvou odpovědí – neopakuj je celé, shrň podstatné a doporuč, čemu se věnovat nejdřív.",
        "Nepoužívej Markdown tabulky ani nadpisy.",
        sources.length
          ? "Máš také očíslované úryvky z dokumentace a záznamy evidencí organizace. Když z nich čerpáš, uveď u tvrzení odkaz ve tvaru [1], [2]. Úryvky, které s dotazem nesouvisejí, ignoruj."
          : "",
        instructions ? `Pokyny organizace: ${instructions}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
    {
      role: "user",
      content:
        `Dotaz: ${question}\n\nVýsledky (JSON):\n${JSON.stringify(data)}` +
        (sources.length ? `\n\nÚryvky a záznamy:\n\n${sources.map((x) => `${sourceHead(x)}\n${x.text}`).join("\n\n")}` : ""),
    },
  ];
}

const cleanAnswer = (t: string) =>
  t
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<details type="reasoning"[\s\S]*?<\/details>/g, "")
    .trim()
    .slice(0, 6000);

/**
 * Běh dotazu na pozadí – výsledek se zapisuje do ai_queries.
 * `retrieve` (v0.50) dodá úryvky dokumentace a záznamy, které uživatel smí číst; model pak volí,
 * zda stačí, nebo spustí i nástroje nad daty – odpověď cituje [n].
 */
export async function runQuery(db: Db, config: Config, id: string, question: string, ctx: ToolCtx, fetchImpl?: FetchLike, retrieve?: () => Promise<RetrievedSource[]>) {
  const s = await getAiSettings(db);
  const t0 = Date.now();
  const update = (v: Partial<typeof aiQueries.$inferInsert>) => db.update(aiQueries).set({ ...v, updatedAt: new Date() }).where(eq(aiQueries.id, id));
  const pub = (list: RetrievedSource[]): AiQuerySource[] => list.map(({ text: _t, ...x }) => x);
  try {
    const client = clientFor(s, config, fetchImpl);
    let sources: RetrievedSource[] = [];
    if (retrieve) {
      try {
        sources = await retrieve();
      } catch (e) {
        console.error("Vyhledání úryvků k dotazu:", (e as Error).message);
      }
    }
    const tools = toolsFor(ctx);
    const known = new Set(tools.map((t) => t.name));
    if (!known.size && !sources.length) throw new Error("Nemáte přístup k žádným datům, na která se lze ptát.");
    let calls: { tool: string; args: Record<string, unknown> }[] = [];
    let model: string | null = null;
    if (known.size) {
      const p = await client.chat(planMessages(question, ctx, s.instructions, sources));
      model = p.model;
      const raw = extractJson(p.text);
      if (raw == null && !sources.length) throw new Error("Model nevrátil platný plán (JSON).");
      const plan = raw == null ? { calls: [], reply: null } : parseQueryPlan(raw, known);
      calls = plan.calls;
      if (!calls.length && !sources.length) {
        await update({ status: "done" satisfies AiQueryStatus, plan: [], answer: plan.reply ?? "K dotazu jsem nenašel vhodný přehled. Zkuste ho položit konkrétněji (např. „Která kritická aktiva nemají vlastníka?“).", model, durationMs: Date.now() - t0 });
        return;
      }
    }
    const titles = new Map(tools.map((t) => [t.name, t.title]));
    const results: AiQueryResult[] = [];
    for (const call of calls) {
      const base = { tool: call.tool, title: titles.get(call.tool) ?? call.tool, args: call.args };
      try {
        results.push({ ...base, ...(await runTool(ctx, call.tool, call.args)) });
      } catch (e) {
        results.push({ ...base, error: (e as Error).message.slice(0, 300) });
      }
    }
    await update({ plan: calls, results, sources: pub(sources) });
    const a = await client.chat(answerMessages(question, results, s.instructions, sources));
    const answer = cleanAnswer(a.text) || "(model nevrátil odpověď – viz tabulky níže)";
    await update({ status: "done", answer, sources: pub(citedSources(answer, sources, results.length > 0)), model: a.model ?? model, durationMs: Date.now() - t0 });
  } catch (e) {
    await update({ status: "error", error: (e as Error).message.slice(0, 1000), durationMs: Date.now() - t0 });
  }
}

export function queryDto(r: typeof aiQueries.$inferSelect, userName?: string | null): AiQueryDto {
  return {
    id: r.id,
    question: r.question,
    status: r.status as AiQueryStatus,
    answer: r.answer,
    results: r.results as AiQueryResult[],
    sources: (r.sources ?? []) as AiQuerySource[],
    error: r.error,
    model: r.model,
    durationMs: r.durationMs,
    createdAt: r.createdAt.toISOString(),
    ...(userName !== undefined ? { userName } : {}),
  };
}
