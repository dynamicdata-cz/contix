import {
  AIACT_LABELS,
  AI_ANNEX_III_KEYS,
  AI_EXCEPTIONS,
  AI_PROHIBITED_KEYS,
  AI_TRANSPARENCY_KEYS,
  AiScreening,
  EMPTY_SCREENING,
  INCIDENT_CATEGORIES,
  INCIDENT_CAUSES,
  INCIDENT_LABELS,
  RECORD_LABELS,
  VEX_JUSTIFICATIONS,
  VEX_LABELS,
  VEX_STATUSES,
  classifyAiSystem,
  cvesOf,
  parseSetFields,
  parseVexItems,
  type AiItem,
  type AiUseCase,
} from "@contix/shared";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/client";
import { aiSystems, assets, craComponents, craFindings, craProducts, incidentAssets, incidents, vulnIntel } from "../../db/schema";
import { componentRefOf } from "../cra/osv";
import { similarRecords, type RecordAccess } from "../search/records";
import type { PreparedRequest } from "./service";

/* ============================================================
 * Úlohy AI v0.99 (ADR-094): screening AI Act, triáž VEX, triáž incidentu s podobnými případy z vektorového indexu.
 * Kontext bez jmen osob; podobné záznamy jen ty, které uživatel smí číst (RecordAccess z požadavku);
 * výstup se validuje proti výčtům a ID z kontextu; aplikace jen po rozhodnutí člověka.
 * ============================================================ */

export const COMPLIANCE_USE_CASES: AiUseCase[] = ["ai_act_screening", "vex_triage", "incident_triage"];
const short = (t: string | null | undefined, n = 600) => (t ? (t.length > n ? `${t.slice(0, n)}…` : t) : null);
const msgs = (system: string, user: string): PreparedRequest["messages"] => [
  { role: "system", content: system },
  { role: "user", content: user },
];

const SCREENING_SPEC = {
  prohibited: { type: "list", values: AI_PROHIBITED_KEYS },
  annexIII: { type: "list", values: AI_ANNEX_III_KEYS },
  annexI: { type: "bool" },
  exception: { type: "enum", values: AI_EXCEPTIONS, nullable: true },
  profiling: { type: "bool" },
  transparency: { type: "list", values: AI_TRANSPARENCY_KEYS },
  gpai: { type: "bool" },
  publicService: { type: "bool" },
  personalData: { type: "bool" },
} as const;
const INCIDENT_SPEC = {
  kind: { type: "enum", values: ["event", "incident"] },
  category: { type: "enum", values: INCIDENT_CATEGORIES },
  cause: { type: "enum", values: INCIDENT_CAUSES },
  suspectedUnlawful: { type: "bool" },
  personalDataBreach: { type: "bool" },
} as const;

export async function prepareCompliance(db: Db, useCase: AiUseCase, entityId: string, system: string, note: string, opts: { note?: string; access?: RecordAccess }): Promise<PreparedRequest | null> {
  /* ---------- screening AI Act ---------- */
  if (useCase === "ai_act_screening") {
    const [a] = await db.select().from(aiSystems).where(eq(aiSystems.id, entityId));
    if (!a) return null;
    const current = (a.screening ? AiScreening.parse(a.screening) : EMPTY_SCREENING) as unknown as Record<string, string | boolean | string[] | null>;
    const input = {
      system: { name: a.name, vendor: a.vendor, model: a.model, role: a.role, source: a.source, purpose: short(a.purpose, 1500), description: short(a.description), users: short(a.users), inputData: short(a.inputData), outputs: short(a.outputs), humanOversight: short(a.humanOversight) },
      currentScreening: a.screening ? current : null,
      options: {
        prohibited: Object.fromEntries(AI_PROHIBITED_KEYS.map((k) => [k, AIACT_LABELS.prohibited[k]])),
        annexIII: Object.fromEntries(AI_ANNEX_III_KEYS.map((k) => [k, AIACT_LABELS.annexIII[k]])),
        exception: Object.fromEntries(AI_EXCEPTIONS.map((k) => [k, AIACT_LABELS.exception[k]])),
        transparency: Object.fromEntries(AI_TRANSPARENCY_KEYS.map((k) => [k, AIACT_LABELS.transparency[k]])),
      },
    };
    const user = [
      "Posuď AI systém podle nařízení (EU) 2024/1689 (AI Act) a navrhni odpovědi screeningu:",
      "prohibited = zakázané praktiky (čl. 5) – jen pokud z popisu jasně vyplývají; annexIII = oblasti vysoce rizikového použití (příloha III);",
      "annexI = bezpečnostní komponenta výrobku podle přílohy I; exception = výjimka čl. 6 odst. 3 (jen u použití z přílohy III, jinak null);",
      "profiling = systém profiluje fyzické osoby; transparency = povinnosti čl. 50; gpai = postaveno na obecném modelu (LLM apod.);",
      "publicService = organizace je veřejný subjekt / poskytuje veřejné služby (jen pokud vyplývá z podkladů); personalData = zpracovává osobní údaje.",
      "Používej jen klíče z options. Kde podklady nestačí, ponech současnou hodnotu a v reasons napiš, co je třeba ověřit.",
      "Schéma odpovědi:",
      '{"summary": "1–3 věty", "screening": {"prohibited": [], "annexIII": ["recruitment"], "annexI": false, "exception": null, "profiling": false, "transparency": ["interacts"], "gpai": true, "publicService": false, "personalData": true}, "reasons": {"annexIII": "proč", "gpai": "proč"}}',
      "AI systém (JSON):",
      JSON.stringify(input),
      note,
    ].join("\n");
    return {
      companyId: a.companyId,
      entityType: "ai_system",
      entityName: a.code ? `${a.code} ${a.name}` : a.name,
      input: { ...input, note: opts.note ?? null },
      messages: msgs(system, user),
      validate: (raw) => {
        const p = parseSetFields(raw, SCREENING_SPEC, current, "screening");
        return { summary: p.summary, items: p.items.map((i) => ({ kind: "set" as const, ...i })) };
      },
    };
  }

  /* ---------- triáž VEX ---------- */
  if (useCase === "vex_triage") {
    const [p] = await db.select().from(craProducts).where(eq(craProducts.id, entityId));
    if (!p) return null;
    const fs = await db.select().from(craFindings).where(and(eq(craFindings.productId, p.id), eq(craFindings.gone, false), eq(craFindings.status, "under_investigation")));
    if (!fs.length) throw new Error("Produkt nemá zranitelnosti ve stavu „Prošetřuje se“.");
    const list = fs.slice(0, 30);
    const comps = await db.select().from(craComponents).where(eq(craComponents.productId, p.id));
    const cm = new Map(comps.map((c) => [componentRefOf(c), c]));
    const cves = [...new Set(list.flatMap((f) => cvesOf(f.vulnId, f.aliases)))];
    const intel = cves.length ? await db.select().from(vulnIntel).where(inArray(vulnIntel.cveId, cves)) : [];
    const im = new Map(intel.map((i) => [i.cveId, i]));
    const input = {
      product: { name: p.name, version: p.version, type: p.productType, purpose: short(p.intendedPurpose, 1500), description: short(p.description) },
      findings: list.map((f) => {
        const c = cm.get(f.componentRef);
        const cv = cvesOf(f.vulnId, f.aliases);
        return {
          findingId: f.id,
          vulnId: f.vulnId,
          cves: cv,
          component: c ? `${c.name} ${c.version ?? ""}`.trim() : f.componentRef,
          summary: short(f.summary, 400),
          severity: f.severity,
          kev: cv.some((x) => im.get(x)?.kev),
          epss: cv.map((x) => im.get(x)?.epss).find((x) => x != null) ?? null,
        };
      }),
      statuses: Object.fromEntries(VEX_STATUSES.map((s) => [s, VEX_LABELS.status[s]])),
      justifications: Object.fromEntries(VEX_JUSTIFICATIONS.map((s) => [s, VEX_LABELS.justification[s]])),
    };
    const user = [
      "Navrhni prohlášení VEX ke zranitelnostem komponent produktu (CRA, příloha I část II). Pro každý nález zvaž, zda může zranitelnost ovlivnit produkt podle jeho účelu a komponenty.",
      "status: affected (zasaženo – navrhni actionStatement), not_affected (nezasaženo – vždy justification z nabídky a impactStatement s vysvětlením), fixed (opraveno – jen pokud to vyplývá z podkladů).",
      "Pokud podklady nestačí k rozhodnutí, nález vynech (zůstane „prošetřuje se“). Zranitelnosti z katalogu KEV posuzuj konzervativně.",
      "Schéma odpovědi:",
      '{"summary": "1–2 věty", "findings": [{"findingId": "…", "status": "not_affected", "justification": "vulnerable_code_not_in_execute_path", "impactStatement": "…", "actionStatement": null, "reason": "proč"}]}',
      "Produkt a nálezy (JSON):",
      JSON.stringify(input),
      note,
    ].join("\n");
    const known = new Map(list.map((f) => [f.id, { vulnId: f.vulnId, componentRef: f.componentRef }]));
    return {
      companyId: p.companyId,
      entityType: "cra_product",
      entityName: `${p.name}${p.version ? ` ${p.version}` : ""}`,
      input: { ...input, note: opts.note ?? null },
      messages: msgs(system, user),
      validate: (raw) => {
        const r = parseVexItems(raw, known, VEX_STATUSES, VEX_JUSTIFICATIONS);
        return { summary: r.summary, items: r.items.map((i) => ({ kind: "vex" as const, ...i })) };
      },
    };
  }

  /* ---------- triáž incidentu s podobnými případy ---------- */
  if (useCase === "incident_triage") {
    const [i] = await db.select().from(incidents).where(eq(incidents.id, entityId));
    if (!i) return null;
    const affected = await db.select({ name: assets.name, type: assets.assetType, criticality: assets.criticality }).from(incidentAssets).innerJoin(assets, eq(assets.id, incidentAssets.targetId)).where(eq(incidentAssets.incidentId, i.id));
    // podobné záznamy z vektorového indexu – jen ty, které uživatel smí číst (bez textů s osobami – index je neobsahuje)
    const similar = opts.access ? (await similarRecords(db, "incident", i.id, opts.access, 6)).hits : [];
    const current = { kind: i.kind === "unassessed" ? null : i.kind, category: i.category, cause: i.cause, suspectedUnlawful: i.suspectedUnlawful, personalDataBreach: i.personalDataBreach };
    const input = {
      incident: {
        title: i.title,
        description: short(i.description, 2000),
        indicators: short(i.indicators, 800),
        impactDescription: short(i.impactDescription, 800),
        containment: short(i.containment, 800),
        detectedAt: i.detectedAt,
        downtimeHours: i.downtimeHours,
        affectedUsers: i.affectedUsers,
      },
      current,
      affectedAssets: affected,
      similarRecords: similar.map((h, n) => ({ n: n + 1, kind: RECORD_LABELS[h.kind], title: h.title, snippet: h.snippet, similarity: h.score })),
      options: {
        kind: { event: INCIDENT_LABELS.kind.event, incident: INCIDENT_LABELS.kind.incident },
        category: Object.fromEntries(INCIDENT_CATEGORIES.map((k) => [k, INCIDENT_LABELS.category[k]])),
        cause: Object.fromEntries(INCIDENT_CAUSES.map((k) => [k, INCIDENT_LABELS.cause[k]])),
      },
    };
    const user = [
      "Proveď triáž bezpečnostní události: navrhni, zda jde o událost (event) nebo incident, kategorii, příčinu, podezření na protiprávní jednání (suspectedUnlawful) a porušení zabezpečení osobních údajů (personalDataBreach).",
      "Využij podobné dřívější záznamy organizace (similarRecords) – v summary uveď, které z nich jsou relevantní (odkazem [n]) a co z nich plyne pro zvládání (opakující se příčina, osvědčené kroky).",
      "Nevymýšlej fakta; kde podklady nestačí, hodnotu nenavrhuj.",
      "Schéma odpovědi:",
      '{"summary": "triáž a poučení z podobných případů s odkazy [n]", "triage": {"kind": "incident", "category": "phishing", "cause": "intentional", "suspectedUnlawful": true, "personalDataBreach": false}, "reasons": {"category": "proč"}}',
      "Incident (JSON):",
      JSON.stringify(input),
      note,
    ].join("\n");
    return {
      companyId: i.companyId,
      entityType: "incident",
      entityName: i.code ? `${i.code} ${i.title}` : i.title,
      input: { ...input, note: opts.note ?? null },
      messages: msgs(system, user),
      validate: (raw) => {
        const p = parseSetFields(raw, INCIDENT_SPEC, current, "triage");
        return { summary: p.summary, items: p.items.map((x) => ({ kind: "set" as const, ...x })) };
      },
    };
  }
  return null;
}

/** Aplikace přijatých položek (stejná pravidla jako ruční úprava). */
export async function applyCompliance(db: Db, useCase: AiUseCase, entityId: string, chosen: AiItem[]) {
  if (useCase === "ai_act_screening") {
    const [a] = await db.select().from(aiSystems).where(eq(aiSystems.id, entityId));
    if (!a) return {};
    const sc = { ...(a.screening ? AiScreening.parse(a.screening) : EMPTY_SCREENING) } as Record<string, unknown>;
    let n = 0;
    for (const it of chosen) if (it.kind === "set" && it.field in SCREENING_SPEC) (sc[it.field] = it.value), n++;
    const screening = AiScreening.parse(sc);
    const prohibited = classifyAiSystem(screening).cls === "prohibited";
    await db
      .update(aiSystems)
      .set({
        screening,
        screenedAt: new Date(),
        // zakázaná praktika ruší rozhodnutí o použití (jako ruční změna screeningu)
        ...(prohibited && a.decidedAt ? { decidedAt: null, decidedById: null, decisionNote: null, status: a.status === "in_use" || a.status === "approved" ? "proposed" : a.status } : {}),
        updatedAt: new Date(),
      })
      .where(eq(aiSystems.id, a.id));
    return { updatedFields: n, cls: classifyAiSystem(screening).cls };
  }
  if (useCase === "vex_triage") {
    let n = 0;
    for (const it of chosen) {
      if (it.kind !== "vex") continue;
      const r = await db
        .update(craFindings)
        .set({ status: it.status, justification: it.justification, impactStatement: it.impactStatement, actionStatement: it.actionStatement, updatedAt: new Date() })
        .where(and(eq(craFindings.id, it.findingId), eq(craFindings.productId, entityId)))
        .returning({ id: craFindings.id });
      n += r.length;
    }
    return { updatedFindings: n };
  }
  if (useCase === "incident_triage") {
    const set: Record<string, unknown> = {};
    for (const it of chosen) if (it.kind === "set" && it.field in INCIDENT_SPEC && it.value !== null) set[it.field] = it.value;
    if (Object.keys(set).length) await db.update(incidents).set({ ...set, updatedAt: new Date() }).where(eq(incidents.id, entityId));
    return { updatedFields: Object.keys(set).length };
  }
  return {};
}
