import { SOC_CONFIDENCE, SOC_OPEN_STATUSES, SOC_SEVERITIES, SOC_VERDICTS, extractJson, triageAction, type SocAiTriage, type SocSimilarAlert, type SocSimilarReason, type Translate } from "@contix/shared";
import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { getSettings } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { alertSuggestions } from "../../db/schema";
import { clientFor, getAiSettings } from "../ai/service";
import type { FetchLike } from "../discovery/connectors/wazuh";
import { CS_T } from "../i18n/service";
import { alertContext } from "./advisor";
import { getSocSettings } from "./service";

/* ============================================================
 * AI předběžná triáž (ADR-051): k novému alertu podobné dřívější rozhodnuté alerty a návrh verdiktu,
 * závažnosti a postupu z lokálního modelu. Návrh se NIKDY neaplikuje sám – analytik ho použije nebo ignoruje.
 * Do modelu nejdou jména osob ani poznámky a zdůvodnění analytiků (jen verdikty dřívějších alertů).
 * ============================================================ */

type Alert = typeof alertSuggestions.$inferSelect;
const SIMILAR_DAYS = 180;

/** Podobné rozhodnuté alerty téže společnosti: stejné pravidlo, hostitel, zdrojová IP nebo technika ATT&CK. */
export async function similarAlerts(db: Db, a: Alert, limit = 5): Promise<SocSimilarAlert[]> {
  const srcip = typeof a.sample?.srcip === "string" ? a.sample.srcip : null;
  const conds = [
    a.ruleId && a.ruleId !== "manual" ? eq(alertSuggestions.ruleId, a.ruleId) : undefined,
    a.agentId ? eq(alertSuggestions.agentId, a.agentId) : undefined,
    a.assetId ? eq(alertSuggestions.assetId, a.assetId) : undefined,
    srcip ? sql`${alertSuggestions.sample}->>'srcip' = ${srcip}` : undefined,
    a.mitreIds.length ? sql`${alertSuggestions.mitreIds} && ${sql`ARRAY[${sql.join(a.mitreIds.map((m) => sql`${m}`), sql`, `)}]::text[]`}` : undefined,
  ].filter(Boolean);
  if (!conds.length) return [];
  const rows = await db
    .select()
    .from(alertSuggestions)
    .where(
      and(
        eq(alertSuggestions.companyId, a.companyId),
        ne(alertSuggestions.id, a.id),
        inArray(alertSuggestions.status, ["accepted", "dismissed"]),
        gte(alertSuggestions.lastSeen, new Date(Date.now() - SIMILAR_DAYS * 864e5)),
        or(...conds),
      ),
    )
    .orderBy(desc(alertSuggestions.lastSeen))
    .limit(200);
  const scored = rows.map((r) => {
    const reasons: SocSimilarReason[] = [];
    let score = 0;
    if (a.ruleId !== "manual" && r.ruleId === a.ruleId) (reasons.push("same_rule"), (score += 3));
    if ((a.agentId && r.agentId === a.agentId) || (a.assetId && r.assetId === a.assetId)) (reasons.push("same_host"), (score += 2));
    if (srcip && r.sample?.srcip === srcip) (reasons.push("same_ip"), (score += 2));
    if (r.mitreIds.some((m) => a.mitreIds.includes(m))) (reasons.push("technique"), (score += 1));
    return { r, reasons, score };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || y.r.lastSeen.getTime() - x.r.lastSeen.getTime())
    .slice(0, limit)
    .map(({ r, reasons }) => ({ id: r.id, title: r.title ?? r.description, status: r.status, verdict: (r.verdict as SocSimilarAlert["verdict"]) ?? (r.status === "accepted" ? "true_positive" : null), lastSeen: r.lastSeen.toISOString(), reasons }));
}

const SYSTEM = (t: Translate) =>
  [
    "Jsi analytik SOC a provádíš předběžnou triáž bezpečnostního alertu pro lidského analytika.",
    "Posuď z údajů o alertu, aktivu, zranitelnostech a z verdiktů podobných dřívějších alertů, zda jde o skutečný útok.",
    "Odpověz POUZE JSON objektem:",
    '{"verdict":"true_positive|false_positive|benign|undetermined","severity":"low|medium|high|critical","confidence":"low|medium|high","reasoning":"2–4 věty"}',
    "- true_positive = pravděpodobně skutečný útok (doporuč eskalaci), false_positive = chybná detekce, benign = skutečná, ale neškodná aktivita, undetermined = nelze určit bez dalšího šetření.",
    "- Pokud se podobné alerty opakovaně uzavíraly jako falešný poplach a nic nového nenasvědčuje útoku, navrhni false_positive nebo benign.",
    "- Pokus o zneužití zranitelného aktiva, řetězec technik nebo technika s velkým dopadem (ransomware, exfiltrace) zvyšuje závažnost.",
    "- Jistota high jen při jasných znacích; při nedostatku údajů undetermined a confidence low.",
    t.locale === "cs" ? "- Zdůvodnění piš česky." : `- Write the reasoning in the user's language (${t.locale}).`,
  ].join("\n");

const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | null => (typeof v === "string" && (allowed as readonly string[]).includes(v.trim().toLowerCase()) ? (v.trim().toLowerCase() as T) : null);

/** Triáž jednoho alertu (model + podobné alerty). Chyba modelu se uloží jako `error` – alert se nezablokuje. */
export async function triageAlert(db: Db, config: Config, a: Alert, t: Translate = CS_T, fetchImpl?: FetchLike): Promise<SocAiTriage> {
  const s = await getAiSettings(db);
  const t0 = Date.now();
  const similar = await similarAlerts(db, a);
  const base: SocAiTriage = { verdict: null, action: null, severity: null, confidence: null, reasoning: "", similar, model: s.model, at: new Date().toISOString(), durationMs: 0, error: null };
  try {
    const hist = similar.length
      ? similar.map((x, i) => `${i + 1}. ${x.title} – ${x.status === "accepted" ? "eskalováno na incident" : `uzavřeno: ${x.verdict ?? "bez verdiktu"}`} (${x.reasons.join(", ")}, ${x.lastSeen.slice(0, 10)})`).join("\n")
      : "žádné";
    const r = await clientFor(s, config, fetchImpl).chat([
      { role: "system", content: s.instructions ? `${SYSTEM(t)}\nPokyny organizace: ${s.instructions}` : SYSTEM(t) },
      { role: "user", content: `Údaje o alertu z CONTIXu:\n${await alertContext(db, a)}\n\nPodobné dřívější rozhodnuté alerty:\n${hist}` },
    ]);
    const j = extractJson(r.text) as Record<string, unknown> | null;
    if (!j || typeof j !== "object") throw new Error("Model nevrátil JSON s návrhem.");
    const verdict = pick(j.verdict, SOC_VERDICTS);
    if (!verdict) throw new Error("Model nevrátil platný verdikt.");
    return {
      ...base,
      verdict,
      action: triageAction(verdict),
      severity: pick(j.severity, SOC_SEVERITIES),
      confidence: pick(j.confidence, SOC_CONFIDENCE) ?? "low",
      reasoning: String(j.reasoning ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim().slice(0, 1200),
      model: r.model ?? s.model,
      durationMs: Date.now() - t0,
    };
  } catch (e) {
    return { ...base, error: (e as Error).message.slice(0, 500), durationMs: Date.now() - t0 };
  }
}

let running = false;
/**
 * Plánovač: otevřené alerty bez triáže (nebo s chybou starší 6 h), nejzávažnější první, v časovém limitu.
 * Běží na pozadí – nikdy dva běhy současně.
 */
export async function processPreTriage(db: Db, config: Config, maxMs = 120_000, fetchImpl?: FetchLike): Promise<number> {
  if (running) return 0;
  const [soc, ai, base] = await Promise.all([getSocSettings(db), getAiSettings(db), getSettings(db)]);
  if (!soc.aiTriage || !ai.enabled || !(base.enabledModules as string[]).includes("soc")) return 0;
  running = true;
  const t0 = Date.now();
  let done = 0;
  try {
    const rows = await db
      .select()
      .from(alertSuggestions)
      .where(
        and(
          inArray(alertSuggestions.status, [...SOC_OPEN_STATUSES]),
          or(isNull(alertSuggestions.aiTriage), sql`(${alertSuggestions.aiTriage}->>'error' is not null and (${alertSuggestions.aiTriage}->>'at')::timestamptz < now() - interval '6 hours')`),
        ),
      )
      .orderBy(desc(alertSuggestions.ruleLevel), desc(alertSuggestions.lastSeen))
      .limit(20);
    for (const a of rows) {
      if (Date.now() - t0 > maxMs) break;
      const tr = await triageAlert(db, config, a, CS_T, fetchImpl);
      await db.update(alertSuggestions).set({ aiTriage: tr as unknown as Record<string, unknown> }).where(eq(alertSuggestions.id, a.id));
      done++;
    }
  } finally {
    running = false;
  }
  return done;
}
