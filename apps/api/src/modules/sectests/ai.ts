import { SECTEST_AREA_LABELS, SECURITY_TESTS, parseSecTestAdvice, parseSecTestSummary, secTestDef, type Translate } from "@contix/shared";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { audit } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { assets, controls, secTestBatches, secTestFindings, secTestRuns } from "../../db/schema";
import { clientFor, getAiSettings } from "../ai/service";
import type { FetchLike } from "../discovery/connectors/wazuh";
import { translatorFor } from "../i18n/service";
import { findingDtos } from "./service";

/* ============================================================
 * AI nad bezpečnostními testy (v1.56, ADR-153; automatizace v1.56.1): rozbor nálezu, shrnutí běhu a sady.
 * Lokální model z Administrace → AI. Do modelu nikdy název ani IP serveru (nahrazeno <server> / H1, H2…).
 * ============================================================ */

export class AiUnavailable extends Error {}

const SYSTEM_ADVICE = [
  "Jsi expert na bezpečnost infrastruktury a penetrační testování. Pomáháš správcům IT pochopit nález z bezpečnostního testu a odstranit ho.",
  "Piš z pohledu obrany. Nepiš návod na zneužití ani exploit, jen princip rizika.",
  "Postup nápravy piš konkrétně (konfigurace, příkazy, GPO), u nejistých údajů to uveď.",
  "Z katalogu testů můžeš doporučit navazující testy (pole nextTests, jen ID z katalogu). Z opatření organizace vyber ta, ke kterým nález patří (pole controlIds, jen ID ze seznamu; když žádné nesedí, prázdné).",
  "Odpověz POUZE jedním objektem JSON bez dalšího textu:",
  '{"summary": "co nález znamená (2–4 věty)", "impact": "dopad", "remediation": ["krok 1", "krok 2"], "verify": "jak ověřit opravu", "nextTests": ["tls.testssl"], "controlIds": ["…"]}',
].join("\n");

const SYSTEM_SUMMARY = [
  "Jsi vedoucí penetračních testů. Ze seznamu nálezů napiš shrnutí do zprávy.",
  "Bez názvů serverů a IP adres (jsou nahrazeny zkratkami H1, H2…). Piš věcně, srozumitelně pro vedení i techniky.",
  "V poli nextTests doporuč testy z katalogu, které by doplnily obraz (jen ID z katalogu; neopakuj testy, které už proběhly, pokud k tomu není důvod).",
  "Odpověz POUZE jedním objektem JSON:",
  '{"management": "shrnutí pro vedení (3–6 vět: stav, hlavní rizika, doporučení)", "technical": "technické shrnutí (nejzávažnější nálezy a příčiny)", "priorities": ["1. co opravit nejdřív", "2. …"], "nextTests": ["ID testu z katalogu"]}',
].join("\n");

const catalogText = () => SECURITY_TESTS.map((t) => `${t.id}: ${t.name} – ${t.description}`).join("\n");

async function chat(db: Db, config: Config, t: Translate, system: string, user: string, fetchImpl?: FetchLike) {
  const s = await getAiSettings(db);
  if (!s.enabled) throw new AiUnavailable("AI asistent není zapnutý.");
  const lang = t.locale === "cs" ? "Texty v JSON piš česky." : `Write the JSON texts in the user's language (${t.locale}).`;
  const r = await clientFor(s, config, fetchImpl).chat([
    { role: "system", content: [system, lang, s.instructions ? `Pokyny organizace: ${s.instructions}` : ""].filter(Boolean).join("\n") },
    { role: "user", content: user },
  ]);
  return { text: r.text, model: (r.model ?? s.model).slice(0, 200) };
}

/** Rozbor nálezu → uloží se k nálezu. */
export async function adviseFinding(db: Db, config: Config, findingId: string, t: Translate, fetchImpl?: FetchLike) {
  const [f] = await db.select().from(secTestFindings).where(eq(secTestFindings.id, findingId));
  if (!f) return null;
  const def = secTestDef(f.testId);
  const [asset] = f.assetId ? await db.select({ type: assets.assetType, criticality: assets.criticality, internetFacing: assets.internetFacing, os: assets.osName }).from(assets).where(eq(assets.id, f.assetId)) : [];
  const ctl = await db.select({ id: controls.id, code: controls.code, name: controls.name }).from(controls).where(eq(controls.companyId, f.companyId)).limit(150);
  const hide = (v: string) => v.replaceAll(f.host, "<server>");
  const user = [
    `Test: ${def?.id} – ${def?.name} (${def?.tool}); oblasti: ${(def?.areas ?? []).map((a) => SECTEST_AREA_LABELS[a]).join(", ")}`,
    `Nález: ${f.code} | závažnost ${f.severity} | ${hide(f.title)}`,
    `Detail: ${hide(f.detail).slice(0, 1500)}`,
    `Důkaz: ${hide(f.evidence).slice(0, 1500)}`,
    `Port: ${f.port ?? "—"}`,
    asset ? `Aktivum: typ ${asset.type}, kritičnost ${asset.criticality ?? "?"}, z internetu ${asset.internetFacing ? "ano" : "ne"}, OS ${asset.os ?? "?"}` : "Aktivum: nespárováno",
    `Katalog testů:\n${catalogText()}`,
    ctl.length ? `Opatření organizace (id | kód | název):\n${ctl.map((x) => `${x.id} | ${x.code ?? ""} | ${x.name.slice(0, 120)}`).join("\n")}` : "Opatření organizace: žádná",
  ].join("\n");
  const r = await chat(db, config, t, SYSTEM_ADVICE, user, fetchImpl);
  const advice = { ...parseSecTestAdvice(r.text, ctl.map((x) => x.id)), model: r.model, generatedAt: new Date().toISOString() };
  // první opatření z rozboru (ověřené proti katalogu společnosti) se převezme jako vazba, pokud ji nález ještě nemá (v1.63)
  await db
    .update(secTestFindings)
    .set({ advice: advice as unknown as Record<string, unknown>, ...(!f.controlId && advice.controlIds[0] ? { controlId: advice.controlIds[0] } : {}), updatedAt: new Date() })
    .where(eq(secTestFindings.id, f.id));
  return advice;
}

function findingLines(fs: Awaited<ReturnType<typeof findingDtos>>) {
  const hosts = new Map<string, string>();
  const h = (x: string) => hosts.get(x) ?? (hosts.set(x, `H${hosts.size + 1}`), hosts.get(x)!);
  return fs.map((f) => `- [${f.severity}] ${secTestDef(f.testId)?.id ?? f.testId} ${h(f.host)}${f.port ? `:${f.port}` : ""} ${f.title.replaceAll(f.host, h(f.host))} | ${f.detail.replaceAll(f.host, h(f.host)).slice(0, 300)} | stav ${f.status}`);
}

/** Shrnutí jednoho běhu → uloží se k běhu. */
export async function summarizeRun(db: Db, config: Config, runId: string, t: Translate, fetchImpl?: FetchLike) {
  const [r] = await db.select().from(secTestRuns).where(eq(secTestRuns.id, runId));
  if (!r) return null;
  const fs = await findingDtos(db, eq(secTestFindings.runId, r.id), 200);
  const def = secTestDef(r.testId);
  const user = [`Test: ${def?.id} – ${def?.name}; zdroj ${r.source}; cílů ${r.targets.length}`, `Statistika: ${JSON.stringify(r.stats)}`, `Nálezy (${fs.length}):`, ...findingLines(fs), `Katalog testů:\n${catalogText()}`].join("\n");
  const out = await chat(db, config, t, SYSTEM_SUMMARY, user, fetchImpl);
  const summary = { ...parseSecTestSummary(out.text), model: out.model, generatedAt: new Date().toISOString() };
  await db.update(secTestRuns).set({ summary: summary as unknown as Record<string, unknown>, updatedAt: new Date() }).where(eq(secTestRuns.id, r.id));
  return summary;
}

/** Shrnutí celé sady (všechny běhy, nálezy) → uloží se k sadě. */
export async function summarizeBatch(db: Db, config: Config, batchId: string, t: Translate, fetchImpl?: FetchLike) {
  const [b] = await db.select().from(secTestBatches).where(eq(secTestBatches.id, batchId));
  if (!b) return null;
  const runs = await db.select({ id: secTestRuns.id, testId: secTestRuns.testId, status: secTestRuns.status, stats: secTestRuns.stats, parent: secTestRuns.parentRunId }).from(secTestRuns).where(eq(secTestRuns.batchId, b.id));
  const fs = runs.length ? await findingDtos(db, inArray(secTestFindings.runId, runs.map((x) => x.id)), 300) : [];
  const user = [
    `Sada testů: ${runs.length} běhů`,
    ...runs.map((x) => `- ${x.testId}${x.parent ? " (navazující)" : ""}: ${x.status}, ${JSON.stringify(x.stats)}`),
    `Nálezy (${fs.length}):`,
    ...findingLines(fs),
    `Katalog testů:\n${catalogText()}`,
  ].join("\n");
  const out = await chat(db, config, t, SYSTEM_SUMMARY, user, fetchImpl);
  const summary = { ...parseSecTestSummary(out.text), model: out.model, generatedAt: new Date().toISOString() };
  await db.update(secTestBatches).set({ summary: summary as unknown as Record<string, unknown>, updatedAt: new Date() }).where(eq(secTestBatches.id, b.id));
  return summary;
}

/** Nejvýš tolik rozborů nálezů na jeden běh (lokální model je pomalý). */
export const AUTO_ADVICE_LIMIT = 10;

/**
 * Automatická AI po dokončení běhu sady (autoAi): rozbor závažných nálezů bez rozboru, shrnutí běhu a – když doběhla
 * celá sada – shrnutí sady. Běží na pozadí; chyby AI se zapíší do auditu, výsledek testu neovlivní.
 */
export async function autoAiAfterRun(db: Db, config: Config, runId: string, fetchImpl?: FetchLike) {
  const [r] = await db.select().from(secTestRuns).where(eq(secTestRuns.id, runId));
  if (!r?.batchId) return { advised: 0, run: false, batch: false };
  const [b] = await db.select().from(secTestBatches).where(eq(secTestBatches.id, r.batchId));
  if (!b?.autoAi || !(await getAiSettings(db)).enabled) return { advised: 0, run: false, batch: false };
  const t = await translatorFor(db, "cs");
  let advised = 0;
  let runDone = false;
  let batchDone = false;
  try {
    const todo = await db
      .select({ id: secTestFindings.id })
      .from(secTestFindings)
      .where(and(eq(secTestFindings.runId, r.id), eq(secTestFindings.status, "open"), isNull(secTestFindings.advice), inArray(secTestFindings.severity, ["critical", "high", "medium"])))
      .orderBy(sql`case ${secTestFindings.severity} when 'critical' then 0 when 'high' then 1 else 2 end`, desc(secTestFindings.lastSeenAt))
      .limit(AUTO_ADVICE_LIMIT);
    for (const f of todo) {
      await adviseFinding(db, config, f.id, t, fetchImpl);
      advised++;
    }
    if ((r.stats as Record<string, number>).findings) {
      await summarizeRun(db, config, r.id, t, fetchImpl);
      runDone = true;
    }
    const [open] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(secTestRuns)
      .where(and(eq(secTestRuns.batchId, b.id), inArray(secTestRuns.status, ["queued", "running"])));
    if (!open?.n) {
      await summarizeBatch(db, config, b.id, t, fetchImpl);
      batchDone = true;
    }
    await audit(db, { action: "sectest.auto_ai", entityType: "sec_test_run", entityId: r.id, details: { advised, run: runDone, batch: batchDone } });
  } catch (e) {
    await audit(db, { action: "sectest.auto_ai_failed", entityType: "sec_test_run", entityId: r.id, details: { advised, error: (e as Error).message.slice(0, 300) } });
  }
  return { advised, run: runDone, batch: batchDone };
}
