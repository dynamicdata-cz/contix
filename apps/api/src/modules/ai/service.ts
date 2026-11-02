import { COMPLIANCE_USE_CASES, applyCompliance, prepareCompliance } from "./usecasesCompliance";
import { applyVulnScanTriage, prepareVulnScanTriage } from "./usecasesVuln";
import { applySupplierReport, prepareSupplierReport } from "./usecasesSupplier";
import { applyQuestionnaire, prepareQuestionnaire, type QaDocs, type QaSemantic } from "./usecasesTrust";
import { recomputeHealth } from "../vulnerabilities/service";
import type { RecordAccess } from "../search/records";
import { profileOf, AI_USE_CASES,
  CONTROL_LABELS,
  extractJson,
  parseMapping,
  parseTreatment,
  requirementById,
  requirementsOf,
  type AiItem,
  type AiSettingsDto,
  type AiSettingsInput,
  type AiUseCase,
  type FrameworkId,
} from "@contix/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { decrypt, encrypt } from "../../auth/crypto";
import { settingsFor } from "../../auth/scope";
import { appSecret, type Config } from "../../config";
import type { Db } from "../../db/client";
import { aiSuggestions, appSettings, assets, controlRequirements, controls, riskAssets, riskCatalog, riskControls, riskTreatmentActions, risks } from "../../db/schema";
import type { FetchLike } from "../discovery/connectors/wazuh";
import { createAiClient, type ChatMessage } from "./provider";
import { applyOther, prepareOther } from "./usecases";

/* ============================================================
 * AI asistent – nastavení, sestavení minimalizovaného kontextu, volání modelu a validace výstupu.
 * Výstup se ukládá jako návrh (ai_suggestions); aplikuje se až na rozhodnutí člověka (applyItems).
 * ============================================================ */

const KEY = "ai";

export interface Stored {
  enabled: boolean;
  provider: "openai" | "ollama";
  baseUrl: string;
  model: string;
  apiKeyEnc: string | null;
  timeoutSec: number;
  temperature: number;
  instructions: string | null;
  mcpEnabled: boolean;
  mcpAllowedIps: string[];
  docQaEnabled: boolean;
  recordSearchEnabled: boolean;
  embeddingModel: string;
  lastTestAt: string | null;
  lastTestResult: string | null;
}

const DEFAULTS: Stored = {
  enabled: false,
  provider: "openai",
  baseUrl: "http://127.0.0.1:8080/api",
  model: "gpt-oss:20b",
  apiKeyEnc: null,
  timeoutSec: 240,
  temperature: 0.2,
  instructions: null,
  mcpEnabled: false,
  mcpAllowedIps: [],
  docQaEnabled: false,
  recordSearchEnabled: false,
  embeddingModel: "bge-m3",
  lastTestAt: null,
  lastTestResult: null,
};

export async function getAiSettings(db: Db): Promise<Stored> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, KEY));
  return { ...DEFAULTS, ...((row?.value as Partial<Stored>) ?? {}) };
}
async function store(db: Db, v: Stored) {
  await db
    .insert(appSettings)
    .values({ key: KEY, value: v })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: v, updatedAt: new Date() } });
}

export const aiSettingsDto = (s: Stored): AiSettingsDto => ({
  enabled: s.enabled,
  provider: s.provider,
  baseUrl: s.baseUrl,
  model: s.model,
  apiKeySet: !!s.apiKeyEnc,
  timeoutSec: s.timeoutSec,
  temperature: s.temperature,
  instructions: s.instructions,
  mcpEnabled: s.mcpEnabled,
  mcpAllowedIps: s.mcpAllowedIps,
  docQaEnabled: s.docQaEnabled,
  recordSearchEnabled: s.recordSearchEnabled,
  embeddingModel: s.embeddingModel,
  lastTestAt: s.lastTestAt,
  lastTestResult: s.lastTestResult,
});

export async function saveAiSettings(db: Db, config: Config, input: AiSettingsInput) {
  const cur = await getAiSettings(db);
  const { apiKey, ...rest } = input;
  const next: Stored = { ...cur, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) };
  if (apiKey !== undefined) next.apiKeyEnc = apiKey ? encrypt(apiKey, appSecret(config)) : null;
  const u = new URL(next.baseUrl);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Adresa AI serveru musí být http(s).");
  next.mcpAllowedIps = [...new Set(next.mcpAllowedIps.map((x) => x.trim()).filter(Boolean))];
  // data z MCP dostane model klienta – server smí běžet jen pro vyjmenované (lokální) klienty
  if (next.mcpEnabled && !next.mcpAllowedIps.length) throw new Error("MCP server lze zapnout jen s omezením na IP adresy klientů (např. server s Open WebUI a lokálním modelem).");
  await store(db, next);
  return next;
}

export function clientFor(s: Stored, config: Config, fetchImpl?: FetchLike) {
  let apiKey: string | null = null;
  try {
    apiKey = s.apiKeyEnc ? decrypt(s.apiKeyEnc, appSecret(config)) : null;
  } catch {
    apiKey = null;
  }
  return createAiClient({ provider: s.provider, baseUrl: s.baseUrl, apiKey, model: s.model, timeoutSec: s.timeoutSec, temperature: s.temperature, embeddingModel: s.embeddingModel }, fetchImpl);
}

/** Test spojení: seznam modelů + krátký dotaz. Výsledek se uloží do nastavení. */
export async function testAi(db: Db, config: Config, fetchImpl?: FetchLike) {
  const s = await getAiSettings(db);
  const client = clientFor(s, config, fetchImpl);
  let message: string;
  let ok = false;
  try {
    let models: string[] = [];
    try {
      models = await client.listModels();
    } catch {
      /* některé brány seznam modelů nevystavují – nevadí */
    }
    const r = await client.chat([
      { role: "system", content: "Odpovídej jedním slovem." },
      { role: "user", content: "Napiš pouze slovo OK." },
    ]);
    ok = true;
    const known = models.length ? (models.includes(s.model) ? "model je dostupný" : `pozor: model ${s.model} není v seznamu (${models.slice(0, 5).join(", ")})`) : "seznam modelů nedostupný";
    message = `Spojení funguje (${(r.durationMs / 1000).toFixed(1)} s, ${known}). Odpověď: „${r.text.trim().slice(0, 60)}“`;
  } catch (e) {
    message = (e as Error).message;
  }
  await store(db, { ...s, lastTestAt: new Date().toISOString(), lastTestResult: message });
  return { ok, message };
}

export async function listAiModels(db: Db, config: Config, fetchImpl?: FetchLike) {
  return clientFor(await getAiSettings(db), config, fetchImpl).listModels();
}

/* ---------------- kontext (minimalizace dat) ---------------- */

const short = (t: string | null | undefined, n = 600) => (t ? (t.length > n ? `${t.slice(0, n)}…` : t) : null);

export interface PreparedRequest {
  companyId: string;
  entityType: string;
  entityName: string;
  input: Record<string, unknown>;
  messages: ChatMessage[];
  validate: (raw: unknown) => { summary: string | null; items: AiItem[] };
}

const SYSTEM = [
  "Jsi asistent pro řízení kybernetické bezpečnosti v GRC systému CONTIX (Česká republika, zákon č. 264/2025 Sb. a vyhlášky č. 409/2025 Sb. a 410/2025 Sb.).",
  "Odpovídáš česky, věcně a konkrétně. Tvé výstupy jsou NÁVRHY, které posoudí a schválí odpovědná osoba.",
  "Nevymýšlej si identifikátory – používej jen ty, které dostaneš v zadání.",
  "Odpověz POUZE jedním JSON objektem podle zadaného schématu, bez dalšího textu.",
].join("\n");

export async function prepareRequest(db: Db, useCase: AiUseCase, entityId: string, opts: { note?: string; framework?: FrameworkId; instructions: string | null; access?: RecordAccess; docs?: QaDocs; semantic?: QaSemantic }): Promise<PreparedRequest | null> {
  const system = opts.instructions ? `${SYSTEM}\nPokyny organizace: ${opts.instructions}` : SYSTEM;
  const note = opts.note ? `\nUpřesnění od uživatele: ${opts.note}` : "";
  if (COMPLIANCE_USE_CASES.includes(useCase)) return prepareCompliance(db, useCase, entityId, system, note, opts);
  if (useCase === "vuln_scan_triage") return prepareVulnScanTriage(db, entityId, system, note, opts);
  if (useCase === "supplier_report_extract") return prepareSupplierReport(db, entityId, system, note, opts);
  if (useCase === "questionnaire_answer") return prepareQuestionnaire(db, entityId, system, note, opts);

  if (useCase === "risk_treatment") {
    const [r] = await db.select().from(risks).where(eq(risks.id, entityId));
    if (!r) return null;
    const settings = await settingsFor(db, null, r.companyId);
    const fw: FrameworkId = profileOf(settings).defaultFramework;
    const [cat, assetRows, ctlRows, actions] = await Promise.all([
      db.select().from(riskCatalog).where(inArray(riskCatalog.id, [r.threatId, r.weaknessId].filter((x): x is string => !!x))),
      db.select({ name: assets.name, type: assets.assetType, criticality: assets.criticality }).from(riskAssets).innerJoin(assets, eq(assets.id, riskAssets.assetId)).where(eq(riskAssets.riskId, r.id)),
      db.select({ code: controls.code, name: controls.name, status: controls.status }).from(riskControls).innerJoin(controls, eq(controls.id, riskControls.controlId)).where(eq(riskControls.riskId, r.id)),
      db.select({ title: riskTreatmentActions.title }).from(riskTreatmentActions).where(eq(riskTreatmentActions.riskId, r.id)),
    ]);
    const threat = cat.find((x) => x.id === r.threatId);
    const weakness = cat.find((x) => x.id === r.weaknessId);
    const sections = [...new Map(requirementsOf(fw).map((q) => [q.section.replace("§ ", ""), q.sectionTitle])).entries()];
    const input = {
      risk: { name: r.name, description: short(r.description), treatment: r.treatment, currentPlan: short(r.treatmentPlan, 400) },
      threat: threat ? { name: threat.name, description: short(threat.description, 300) } : null,
      weakness: weakness ? { name: weakness.name, description: short(weakness.description, 300) } : null,
      assets: assetRows.slice(0, 15),
      existingControls: ctlRows.slice(0, 20).map((x) => ({ code: x.code, name: x.name, status: CONTROL_LABELS.status[x.status as keyof typeof CONTROL_LABELS.status] ?? x.status })),
      existingActions: actions.map((a) => a.title).slice(0, 20),
      decree: fw === "cz409" ? "vyhláška č. 409/2025 Sb." : "vyhláška č. 410/2025 Sb.",
    };
    const user = [
      "Navrhni 3–6 konkrétních bezpečnostních opatření pro zvládání tohoto rizika (snížení pravděpodobnosti nebo dopadu).",
      "Nenavrhuj opatření, která už existují (existingControls, existingActions).",
      `Ke každému uveď čísla § ${input.decree}, ke kterým patří – vybírej jen z tohoto seznamu:`,
      sections.map(([p, t]) => `§ ${p} ${t}`).join("; "),
      "Schéma odpovědi:",
      '{"summary": "1–2 věty shrnutí", "measures": [{"title": "krátký název opatření", "description": "co konkrétně zavést", "objective": "cíl a přínos", "category": "organizational|technical|physical|people", "paragraphs": ["13"]}]}',
      "Kontext rizika (JSON):",
      JSON.stringify(input),
      note,
    ].join("\n");
    const known = new Set(sections.map(([p]) => p));
    return {
      companyId: r.companyId,
      entityType: "risk",
      entityName: r.name,
      input: { ...input, framework: fw, note: opts.note ?? null },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      validate: (raw) => {
        const p = parseTreatment(raw, (x) => known.has(x));
        return { summary: p.summary, items: p.items.map((i) => ({ kind: "treatment" as const, ...i })) };
      },
    };
  }

  if (useCase !== "control_mapping") return prepareOther(db, useCase, entityId, system, note, opts);

  // control_mapping
  const [ctl] = await db.select().from(controls).where(eq(controls.id, entityId));
  if (!ctl) return null;
  const settings = await settingsFor(db, null, ctl.companyId);
  const fw: FrameworkId = opts.framework ?? (profileOf(settings).defaultFramework);
  const linked = new Set((await db.select({ id: controlRequirements.requirementId }).from(controlRequirements).where(eq(controlRequirements.controlId, ctl.id))).map((x) => x.id));
  const candidates = requirementsOf(fw).filter((q) => !linked.has(q.id));
  const input = {
    control: { code: ctl.code, name: ctl.name, description: short(ctl.description), category: ctl.category, implementation: short(ctl.implementation, 400) },
    alreadyMapped: [...linked].filter((id) => id.startsWith(`${fw}:`)),
    framework: fw,
  };
  const user = [
    "Urči, které požadavky zadaného rámce toto bezpečnostní opatření (plně nebo z podstatné části) naplňuje.",
    "Vyber nejvýše 15 nejrelevantnějších; když žádný nesedí, vrať prázdný seznam. Vybírej jen z nabídnutých ID.",
    "Schéma odpovědi:",
    '{"summary": "1 věta", "requirements": [{"requirementId": "přesné ID ze seznamu", "reason": "proč opatření požadavek naplňuje"}]}',
    "Opatření (JSON):",
    JSON.stringify(input.control),
    `Požadavky rámce (ID | text):`,
    candidates.map((q) => `${q.id} | ${q.ref} ${short(q.text, 140)}`).join("\n"),
    note,
  ].join("\n");
  return {
    companyId: ctl.companyId,
    entityType: "control",
    entityName: ctl.code ? `${ctl.code} ${ctl.name}` : ctl.name,
    input: { ...input, candidates: candidates.length, note: opts.note ?? null },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    validate: (raw) => {
      const p = parseMapping(raw, (id) => id.startsWith(`${fw}:`) && !!requirementById(id), linked);
      return {
        summary: p.summary,
        items: p.items.map((i) => {
          const q = requirementById(i.requirementId)!;
          return { kind: "mapping" as const, ...i, ref: q.ref, text: short(q.text, 300)! };
        }),
      };
    },
  };
}

/** Spustí dotaz na model a výsledek zapíše k návrhu (běží na pozadí – odpověď lokálního modelu trvá desítky sekund). */
export async function runSuggestion(db: Db, config: Config, id: string, prep: PreparedRequest, fetchImpl?: FetchLike) {
  const s = await getAiSettings(db);
  const t0 = Date.now();
  try {
    const r = await clientFor(s, config, fetchImpl).chat(prep.messages);
    const parsed = extractJson(r.text);
    if (parsed == null) throw Object.assign(new Error("Model nevrátil platný JSON."), { raw: r.text });
    const v = prep.validate(parsed);
    await db
      .update(aiSuggestions)
      .set({ status: "proposed", rawOutput: r.text.slice(0, 20_000), summary: v.summary, items: v.items, model: r.model, durationMs: Date.now() - t0, updatedAt: new Date() })
      .where(eq(aiSuggestions.id, id));
  } catch (e) {
    await db
      .update(aiSuggestions)
      .set({ status: "failed", error: (e as Error).message.slice(0, 1000), rawOutput: ((e as { raw?: string }).raw ?? null)?.slice(0, 20_000) ?? null, durationMs: Date.now() - t0, updatedAt: new Date() })
      .where(eq(aiSuggestions.id, id));
  }
}

/** Aplikace přijatých položek – vytvoří akce plánu zvládání / doplní mapování požadavků. */
export async function applyItems(db: Db, row: typeof aiSuggestions.$inferSelect, accepted: number[], userId: string | null = null) {
  const items = row.items as AiItem[];
  const chosen = accepted.map((i) => items[i]).filter((x): x is AiItem => !!x);
  if (COMPLIANCE_USE_CASES.includes(row.useCase as AiUseCase)) return applyCompliance(db, row.useCase as AiUseCase, row.entityId, chosen);
  if (row.useCase === "supplier_report_extract") return applySupplierReport(db, row.entityId, chosen);
  if (row.useCase === "questionnaire_answer") return applyQuestionnaire(db, row.entityId, chosen);
  if (row.useCase === "vuln_scan_triage") {
    const r = await applyVulnScanTriage(db, row.entityId, chosen, userId);
    if (r.updatedFindings) await recomputeHealth(db);
    return r;
  }
  if (row.useCase === "risk_treatment") {
    const created: string[] = [];
    for (const it of chosen) {
      if (it.kind !== "treatment") continue;
      // vazba na opatření společnosti, které pokrývá první uvedený §
      let controlId: string | null = null;
      for (const par of it.paragraphs) {
        const [hit] = await db
          .select({ id: controls.id })
          .from(controlRequirements)
          .innerJoin(controls, eq(controls.id, controlRequirements.controlId))
          .where(and(eq(controls.companyId, row.companyId), sql`${controlRequirements.requirementId} ~ ${`^(cz409|cz410):${par}(/|$)`}`))
          .limit(1);
        if (hit) {
          controlId = hit.id;
          break;
        }
      }
      const refs = it.paragraphs.length ? `\n\nVazba na vyhlášku: ${it.paragraphs.map((p) => `§ ${p}`).join(", ")}.` : "";
      const [a] = await db
        .insert(riskTreatmentActions)
        .values({ riskId: row.entityId, controlId, title: it.title, description: `${it.description}${refs}`.trim() || null, objective: it.objective || null })
        .returning({ id: riskTreatmentActions.id });
      created.push(a!.id);
    }
    return { createdActions: created.length };
  }
  if (row.useCase !== "control_mapping") return applyOther(db, row.useCase as AiUseCase, row.entityId, chosen, { userId, summary: row.summary, companyId: row.companyId });
  const ids = chosen.filter((x) => x.kind === "mapping").map((x) => (x as { requirementId: string }).requirementId);
  if (ids.length) await db.insert(controlRequirements).values(ids.map((requirementId) => ({ controlId: row.entityId, requirementId }))).onConflictDoNothing();
  return { addedRequirements: ids.length };
}

export const isUseCase = (v: string): v is AiUseCase => (AI_USE_CASES as readonly string[]).includes(v);
