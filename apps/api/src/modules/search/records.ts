import {
  INCIDENT_LABELS,
  AUDIT_LABELS,
  CONTROL_LABELS,
  LABELS,
  LEGAL_LABELS,
  PROCESS_LABELS,
  TRUST_LABELS,
  knowledgeChunks,
  type RecordIndexItemDto,
  type RecordIndexSettings,
  AIACT_LABELS,
  VEX_LABELS,
  AiScreening,
  classifyAiSystem,
  RECORD_KINDS,
  RISK_LABELS,
  EXCEPTION_KINDS,
  recordSnippet,
  riskScore,
  type RecordHit,
  type RecordIndexStatusDto,
  type RecordKind,
} from "@contix/shared";
import { and, count, eq, inArray, isNotNull, max, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { createHash } from "node:crypto";
import { getCompanies, riskPolicies } from "../../auth/scope";
import { getSettings } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { aiSystems, answerLibrary, appSettings, assets, assetVulnerabilities, auditFindings, audits, controls, craFindings, craProducts, incidents, knowledgeArticles, legalActs, legalChanges, legalReviews, processes, recordVectors, riskCatalog, risks, suppliers } from "../../db/schema";
import { clientFor, getAiSettings } from "../ai/service";
import type { FetchLike } from "../discovery/connectors/wazuh";
import { loadExceptions } from "../exceptions/service";
import { normalizeSearch } from "../policies/convert";
import { cosine, prefixTsQuery } from "../../lib/vector";
import { acquireLease, releaseLease } from "../ops/lease";

/* ============================================================
 * Vektorový index záznamů (ADR-044). Texty se skládají ze záznamů bez jmen osob, změna se pozná podle otisku
 * (název + text + společnost); plánovač dopočítá vektory po dávkách, zaniklé záznamy z indexu odstraní.
 * ============================================================ */

export interface RecordDoc {
  kind: RecordKind;
  refId: string;
  companyId: string;
  title: string;
  text: string;
  link: string;
  meta: Record<string, string | number | null>;
}

const EMBED_BATCH = 16;
const line = (label: string, v: string | null | undefined) => (v && v.trim() ? `${label}: ${v.trim()}` : null);
const join = (...parts: (string | null)[]) => parts.filter(Boolean).join("\n");
export const docHash = (d: RecordDoc) => createHash("sha256").update(`${d.companyId}\n${d.title}\n${d.text}\n${d.link}\n${JSON.stringify(d.meta)}`).digest("hex");

/** Dokumenty k indexaci – všechny společnosti, jen zapnuté moduly. */
export async function collectRecordDocs(db: Db): Promise<RecordDoc[]> {
  const base = await getSettings(db);
  const on = (m: string) => (base.enabledModules as string[]).includes(m);
  const out: RecordDoc[] = [];
  const companyIds = (await getCompanies(db)).map((c) => c.id);
  if (on("risks")) {
    const threat = alias(riskCatalog, "rv_threat");
    const weak = alias(riskCatalog, "rv_weak");
    const pol = await riskPolicies(db, base);
    const rows = await db
      .select({ r: risks, threat: threat.name, weak: weak.name })
      .from(risks)
      .leftJoin(threat, eq(threat.id, risks.threatId))
      .leftJoin(weak, eq(weak.id, risks.weaknessId));
    for (const { r, threat: th, weak: wk } of rows) {
      const level = pol.get(r.companyId) ? riskScore(pol.get(r.companyId)!, r, r.scaleLevels).level : null;
      const title = `${r.code ? `${r.code} ` : ""}${r.name}`;
      out.push({
        kind: "risk",
        refId: r.id,
        companyId: r.companyId,
        title,
        text: join(`Riziko: ${title}`, line("Popis", r.description), line("Hrozba", th), line("Zranitelnost", wk), line("Úroveň", level ? RISK_LABELS.level[level] : null), line("Stav", RISK_LABELS.status[r.status]), line("Plán zvládání", r.treatmentPlan)),
        link: `/risks/${r.id}`,
        meta: { status: r.status, level },
      });
    }
  }
  if (on("vulnerabilities")) {
    // jedna položka = CVE ve společnosti (napříč aktivy), jen otevřené / s výjimkou
    const rows = await db
      .select({ v: assetVulnerabilities, companyId: assets.companyId, asset: assets.name })
      .from(assetVulnerabilities)
      .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
      .where(inArray(assetVulnerabilities.status, ["open", "accepted"]));
    const by = new Map<string, { companyId: string; cve: string; sev: string; cvss: number | null; desc: string | null; pkgs: Set<string>; assets: Map<string, string> }>();
    const SEV = ["unknown", "low", "medium", "high", "critical"];
    for (const { v, companyId, asset } of rows) {
      const k = `${companyId}:${v.cveId}`;
      const g = by.get(k) ?? { companyId, cve: v.cveId, sev: v.severity, cvss: v.cvssScore, desc: v.description, pkgs: new Set<string>(), assets: new Map<string, string>() };
      if (SEV.indexOf(v.severity) > SEV.indexOf(g.sev)) g.sev = v.severity;
      if ((v.cvssScore ?? 0) > (g.cvss ?? 0)) g.cvss = v.cvssScore;
      g.desc ??= v.description;
      if (v.packageName) g.pkgs.add(`${v.packageName}${v.packageVersion ? ` ${v.packageVersion}` : ""}`);
      g.assets.set(v.assetId, asset);
      by.set(k, g);
    }
    for (const [k, g] of by) {
      const assetList = [...g.assets.values()];
      out.push({
        kind: "vulnerability",
        refId: k,
        companyId: g.companyId,
        title: g.cve,
        text: join(`Zranitelnost ${g.cve}`, line("Popis", g.desc?.slice(0, 2000)), line("Závažnost", `${g.sev}${g.cvss != null ? `, CVSS ${g.cvss}` : ""}`), line("Balíčky", [...g.pkgs].slice(0, 10).join(", ")), line("Aktiva", `${assetList.length}: ${assetList.slice(0, 10).join(", ")}`)),
        link: g.assets.size === 1 ? `/assets/${[...g.assets.keys()][0]}` : "/vulnerabilities",
        meta: { severity: g.sev, cvss: g.cvss, assets: g.assets.size },
      });
    }
  }
  if (on("incidents")) {
    const rows = await db.select().from(incidents);
    for (const r of rows) {
      const title = `${r.code ? `${r.code} ` : ""}${r.title}`;
      out.push({
        kind: "incident",
        refId: r.id,
        companyId: r.companyId,
        title,
        // bez osoby, která událost nahlásila (reportedBy) – do modelu jdou jen věcné údaje
        text: join(
          `${INCIDENT_LABELS.kind[r.kind]}: ${title}`,
          line("Popis", r.description),
          line("Kategorie", INCIDENT_LABELS.category[r.category]),
          line("Příčina", INCIDENT_LABELS.cause[r.cause]),
          line("Dopad", r.impactDescription),
          line("Indikátory", r.indicators),
          line("Omezení šíření", r.containment),
          line("Kořenová příčina", r.rootCause),
          line("Poučení", r.lessonsLearned),
        ),
        link: `/incidents/${r.id}`,
        meta: { status: r.status, kind: r.kind, date: r.detectedAt?.toISOString().slice(0, 10) ?? null },
      });
    }
  }
  // zjištění auditů včetně výjimek SOC 2 (v0.99)
  if (on("audits")) {
    const rows = await db.select({ f: auditFindings, a: audits }).from(auditFindings).innerJoin(audits, eq(audits.id, auditFindings.auditId));
    for (const { f, a } of rows) {
      const title = `${f.code ? `${f.code} ` : ""}${f.title}`;
      out.push({
        kind: "audit_finding",
        refId: f.id,
        companyId: a.companyId,
        title,
        text: join(`Zjištění auditu: ${title}`, line("Audit", a.title), line("Popis", f.description), line("Závažnost", AUDIT_LABELS.severity[f.severity]), line("Požadavek", f.requirementId), line("Nápravné opatření / vyjádření vedení", f.correctiveAction)),
        link: `/audits/${a.id}`,
        meta: { status: f.status, severity: f.severity },
      });
    }
  }
  // AI systémy (AI Act) – účel, data, klasifikace (bez osob)
  if (on("aiact")) {
    for (const s of await db.select().from(aiSystems)) {
      const cls = classifyAiSystem(s.screening ? AiScreening.parse(s.screening) : null).cls;
      const title = `${s.code ? `${s.code} ` : ""}${s.name}`;
      out.push({
        kind: "ai_system",
        refId: s.id,
        companyId: s.companyId,
        title,
        text: join(`AI systém: ${title}`, line("Dodavatel", [s.vendor, s.model].filter(Boolean).join(" ")), line("Účel", s.purpose), line("Vstupní data", s.inputData), line("Výstupy", s.outputs), line("Lidský dohled", s.humanOversight), line("Klasifikace", AIACT_LABELS.cls[cls]), line("Stav", AIACT_LABELS.status[s.status as keyof typeof AIACT_LABELS.status])),
        link: `/aiact/${s.id}`,
        meta: { status: s.status, cls },
      });
    }
  }
  // zranitelnosti komponent produktů (CRA, ADR-093) – jen aktuální
  if (on("cra")) {
    const rows = await db.select({ f: craFindings, p: craProducts.name, v: craProducts.version }).from(craFindings).innerJoin(craProducts, eq(craProducts.id, craFindings.productId)).where(eq(craFindings.gone, false));
    for (const { f, p, v } of rows) {
      const title = `${f.vulnId} – ${p}${v ? ` ${v}` : ""}`;
      out.push({
        kind: "cra_finding",
        refId: f.id,
        companyId: f.companyId,
        title,
        text: join(`Zranitelnost produktu ${title}`, line("Komponenta", f.componentRef), line("Aliasy", f.aliases.join(", ")), line("Popis", f.summary), line("Závažnost", f.severity), line("Stav VEX", VEX_LABELS.status[f.status as keyof typeof VEX_LABELS.status]), line("Posouzení", f.impactStatement), line("Opatření", f.actionStatement)),
        link: `/cra/${f.productId}`,
        meta: { status: f.status },
      });
    }
  }
  /* ---------- v1.07 (ADR-103): opatření, aktiva, procesy, dodavatelé, legislativa, knihovna odpovědí, znalostní články ---------- */
  if (on("controls")) {
    for (const c of await db.select().from(controls)) {
      const title = `${c.code ? `${c.code} ` : ""}${c.name}`;
      out.push({
        kind: "control",
        refId: c.id,
        companyId: c.companyId,
        title,
        text: join(`Opatření: ${title}`, line("Popis", c.description), line("Implementace", c.implementation), line("Doklad", c.evidence), line("Stav", CONTROL_LABELS.status[c.status as keyof typeof CONTROL_LABELS.status]), line("Účinnost", CONTROL_LABELS.effectiveness[c.effectiveness as keyof typeof CONTROL_LABELS.effectiveness])),
        link: `/controls/${c.id}`,
        meta: { status: c.status, effectiveness: c.effectiveness },
      });
    }
  }
  if (on("assets")) {
    // bez jména vlastníka, IP / MAC a sériových čísel – jen věcný popis aktiva
    for (const a of await db.select({ id: assets.id, companyId: assets.companyId, name: assets.name, description: assets.description, assetType: assets.assetType, criticality: assets.criticality, osName: assets.osName, osVersion: assets.osVersion, location: assets.location, hostname: assets.hostname }).from(assets)) {
      out.push({
        kind: "asset",
        refId: a.id,
        companyId: a.companyId,
        title: a.name,
        text: join(`Aktivum: ${a.name}`, line("Typ", LABELS.assetType[a.assetType as keyof typeof LABELS.assetType]), line("Popis", a.description), line("Hostname", a.hostname), line("Operační systém", [a.osName, a.osVersion].filter(Boolean).join(" ")), line("Umístění", a.location), line("Kritičnost", LABELS.criticality[a.criticality as keyof typeof LABELS.criticality])),
        link: `/assets/${a.id}`,
        meta: { assetType: a.assetType, criticality: a.criticality },
      });
    }
  }
  if (on("processes")) {
    for (const p of await db.select().from(processes)) {
      const title = `${p.code ? `${p.code} ` : ""}${p.name}`;
      out.push({
        kind: "process",
        refId: p.id,
        companyId: p.companyId,
        title,
        text: join(`Proces: ${title}`, line("Účel", p.purpose), line("Popis", p.description), line("Spouštěč", p.trigger), line("Vstupy", p.inputs), line("Výstupy", p.outputs), line("Legislativa", p.legislation), line("Stav", PROCESS_LABELS.status[p.status as keyof typeof PROCESS_LABELS.status])),
        link: `/processes/${p.id}`,
        meta: { status: p.status },
      });
    }
  }
  if (on("suppliers")) {
    // bez kontaktních osob a e-mailů
    for (const x of await db.select({ id: suppliers.id, companyId: suppliers.companyId, name: suppliers.name, ico: suppliers.ico, country: suppliers.country, supply: suppliers.supplyDescription, significant: suppliers.significant, reason: suppliers.significanceReason, status: suppliers.status }).from(suppliers)) {
      out.push({
        kind: "supplier",
        refId: x.id,
        companyId: x.companyId,
        title: x.name,
        text: join(`Dodavatel: ${x.name}`, line("IČO", x.ico), line("Země", x.country), line("Předmět plnění", x.supply), line("Významný dodavatel", x.significant ? `ano${x.reason ? ` – ${x.reason}` : ""}` : "ne")),
        link: `/suppliers/${x.id}`,
        meta: { significant: x.significant ? 1 : 0, status: x.status },
      });
    }
  }
  if (on("legislation")) {
    const rows = await db
      .select({ r: legalReviews, act: legalActs.title, code: legalActs.code })
      .from(legalReviews)
      .innerJoin(legalChanges, eq(legalChanges.id, legalReviews.changeId))
      .innerJoin(legalActs, eq(legalActs.id, legalChanges.actId));
    for (const { r, act, code } of rows) {
      const title = `${code ? `${code} ` : ""}${act}`;
      out.push({
        kind: "legal_review",
        refId: r.id,
        companyId: r.companyId,
        title: `Změna: ${title}`,
        text: join(`Posouzení změny předpisu ${title}`, line("Shrnutí změny", r.aiSummary), line("Posouzení dopadu", r.assessment), line("Stav", LEGAL_LABELS.reviewStatus[r.status as keyof typeof LEGAL_LABELS.reviewStatus])),
        link: `/legislation/reviews/${r.id}`,
        meta: { status: r.status },
      });
    }
  }
  if (on("trust")) {
    for (const l of await db.select().from(answerLibrary)) {
      out.push({
        kind: "qa_answer",
        refId: l.id,
        companyId: l.companyId,
        title: l.question.slice(0, 300),
        text: join(`Otázka: ${l.question}`, line("Odpověď", TRUST_LABELS.answer[l.answer as keyof typeof TRUST_LABELS.answer] ?? l.answer), line("Text odpovědi", l.answerText), line("Štítky", l.tags.join(", "))),
        link: "/trust?tab=library",
        meta: { answer: l.answer },
      });
    }
  }
  if (on("knowledge")) {
    for (const k of await db.select().from(knowledgeArticles).where(eq(knowledgeArticles.status, "published"))) {
      for (const [i, ch] of knowledgeChunks(k.title, k.body).entries()) {
        out.push({
          kind: "knowledge",
          refId: `${k.id}#${i}`,
          companyId: k.companyId,
          title: ch.heading ? `${k.title} – ${ch.heading}` : k.title,
          text: join(`Znalostní článek: ${k.title}${ch.heading ? ` – ${ch.heading}` : ""}`, line("Štítky", k.tags.join(", ")), ch.text),
          link: `/knowledge/${k.id}`,
          meta: { article: k.id },
        });
      }
    }
  }
  const exScope = Object.fromEntries(
    EXCEPTION_KINDS.map((k) => [k, on({ identity_finding: "identity", sod_violation: "identity", vulnerability: "vulnerabilities", risk_accepted: "risks", requirement_na: "controls", soc_suppression: "soc" }[k]) ? companyIds : []]),
  );
  for (const e of await loadExceptions(db, exScope)) {
    out.push({
      kind: "exception",
      refId: e.key,
      companyId: e.companyId,
      title: e.title,
      // bez jména toho, kdo výjimku udělil
      text: join(`Výjimka: ${e.title}`, line("Podrobnosti", e.detail), line("Odůvodnění", e.reason), line("Platnost do", e.until), line("Závažnost", e.severity)),
      link: e.link,
      meta: { sub: e.kind, state: e.state, until: e.until },
    });
  }
  return out;
}

/* ---------- správa indexu (v1.07, ADR-103) ---------- */
const SETTINGS_KEY = "records.index";
export async function getRecordIndexSettings(db: Db): Promise<RecordIndexSettings> {
  const [r] = await db.select().from(appSettings).where(eq(appSettings.key, SETTINGS_KEY));
  return { disabledKinds: [], ...((r?.value as Partial<RecordIndexSettings>) ?? {}) };
}
export async function storeRecordIndexSettings(db: Db, v: RecordIndexSettings) {
  await db.insert(appSettings).values({ key: SETTINGS_KEY, value: v }).onConflictDoUpdate({ target: appSettings.key, set: { value: v, updatedAt: new Date() } });
}
const LEASE = "records.reindex";
let running: Promise<number> | null = null;
export const recordIndexRunning = () => running;
/** Ruční přeindexování na pozadí (jedna úloha na instanci, lease mezi instancemi). */
export async function startRecordReindex(db: Db, config: Config, fetchImpl?: FetchLike): Promise<boolean> {
  if (running || !(await acquireLease(db, LEASE, 60 * 60_000))) return false;
  running = processRecordIndex(db, config, 30 * 60_000, fetchImpl)
    .catch((e) => {
      console.error("Indexace záznamů:", (e as Error).message);
      return 0;
    })
    .finally(async () => {
      await releaseLease(db, LEASE);
      running = null;
    });
  return true;
}

/** Synchronizace indexu: nové / změněné záznamy (a jiný model) se přepočítají, zaniklé smažou. Vrací počet zpracovaných. */
export async function processRecordIndex(db: Db, config: Config, maxMs = 5 * 60_000, fetchImpl?: FetchLike): Promise<number> {
  const s = await getAiSettings(db);
  const model = s.enabled && s.recordSearchEnabled ? s.embeddingModel : null;
  const off = new Set((await getRecordIndexSettings(db)).disabledKinds);
  // vypnuté druhy se z indexu odeberou (jako zaniklé záznamy)
  const docs = (await collectRecordDocs(db)).filter((d) => !off.has(d.kind));
  const existing = await db.select({ id: recordVectors.id, kind: recordVectors.kind, refId: recordVectors.refId, hash: recordVectors.contentHash, model: recordVectors.model, error: recordVectors.error, at: recordVectors.indexedAt }).from(recordVectors);
  const byKey = new Map(existing.map((e) => [`${e.kind}:${e.refId}`, e]));
  const seen = new Set<string>();
  const todo: { d: RecordDoc; hash: string }[] = [];
  for (const d of docs) {
    const key = `${d.kind}:${d.refId}`;
    seen.add(key);
    const hash = docHash(d);
    const cur = byKey.get(key);
    const retry = !!cur?.error && Date.now() - cur.at.getTime() > 60 * 60_000;
    if (!cur || cur.hash !== hash || (model && cur.model !== model && !cur.error) || (!model && cur.model) || retry) todo.push({ d, hash });
  }
  const gone = existing.filter((e) => !seen.has(`${e.kind}:${e.refId}`)).map((e) => e.id);
  for (let i = 0; i < gone.length; i += 500) await db.delete(recordVectors).where(inArray(recordVectors.id, gone.slice(i, i + 500)));
  const until = Date.now() + maxMs;
  const client = model ? clientFor(s, config, fetchImpl) : null;
  let n = 0;
  for (let i = 0; i < todo.length && Date.now() < until; i += EMBED_BATCH) {
    const batch = todo.slice(i, i + EMBED_BATCH);
    let vectors: (number[] | null)[] = batch.map(() => null);
    let error: string | null = null;
    if (client) {
      try {
        vectors = await client.embed(batch.map((b) => b.d.text));
      } catch (e) {
        error = (e as Error).message.slice(0, 500);
      }
    }
    for (const [k, { d, hash }] of batch.entries()) {
      const row = { companyId: d.companyId, title: d.title.slice(0, 500), text: d.text, searchText: normalizeSearch(`${d.title}\n${d.text}`), link: d.link.slice(0, 500), meta: d.meta, contentHash: hash, embedding: vectors[k] ?? null, model: vectors[k] ? model : null, error, indexedAt: new Date() };
      await db.insert(recordVectors).values({ kind: d.kind, refId: d.refId, ...row }).onConflictDoUpdate({ target: [recordVectors.kind, recordVectors.refId], set: row });
    }
    n += batch.length;
  }
  return n;
}

export async function recordIndexStatus(db: Db, companyIds: string[]): Promise<RecordIndexStatusDto> {
  const s = await getAiSettings(db);
  const model = s.enabled && s.recordSearchEnabled ? s.embeddingModel : null;
  const byKind = Object.fromEntries(RECORD_KINDS.map((k) => [k, { records: 0, indexed: 0 }])) as RecordIndexStatusDto["byKind"];
  if (!companyIds.length) return { enabled: !!model, embeddingModel: s.embeddingModel, byKind, lastIndexedAt: null, errors: 0 };
  const rows = await db
    .select({ kind: recordVectors.kind, n: count(), indexed: sql<number>`count(*) filter (where ${recordVectors.embedding} is not null and ${recordVectors.model} = ${model ?? ""})::int`, excluded: sql<number>`count(*) filter (where ${recordVectors.excluded})::int`, errors: sql<number>`count(*) filter (where ${recordVectors.error} is not null)::int`, last: max(recordVectors.indexedAt) })
    .from(recordVectors)
    .where(inArray(recordVectors.companyId, companyIds))
    .groupBy(recordVectors.kind);
  let last: Date | null = null;
  let errors = 0;
  for (const r of rows) {
    if (r.kind in byKind) byKind[r.kind as RecordKind] = { records: r.n, indexed: r.indexed, excluded: r.excluded };
    if (r.last && (!last || r.last > last)) last = r.last;
    errors += r.errors;
  }
  const disabledKinds = (await getRecordIndexSettings(db)).disabledKinds;
  const pending = Object.entries(byKind).reduce((n, [, v]) => n + Math.max(0, v.records - v.indexed), 0);
  return { enabled: !!model, embeddingModel: s.embeddingModel, byKind, lastIndexedAt: last?.toISOString() ?? null, errors, disabledKinds, pending: model ? pending : 0, running: !!running };
}

/** Náhled indexu pro správce (v1.07): text, stav, vyřazení. */
export async function recordIndexItems(db: Db, companyIds: string[], q: { kind?: RecordKind; q?: string; excluded?: boolean; offset?: number }): Promise<{ total: number; items: RecordIndexItemDto[] }> {
  if (!companyIds.length) return { total: 0, items: [] };
  const conds = [inArray(recordVectors.companyId, companyIds), q.kind ? eq(recordVectors.kind, q.kind) : undefined, q.excluded ? eq(recordVectors.excluded, true) : undefined];
  if (q.q?.trim()) conds.push(sql`${recordVectors.searchText} like ${`%${normalizeSearch(q.q.trim()).replace(/[\\%_]/g, (m) => `\\${m}`)}%`}`);
  const where = and(...conds);
  const [{ n }] = (await db.select({ n: count() }).from(recordVectors).where(where)) as [{ n: number }];
  const rows = await db.select().from(recordVectors).where(where).orderBy(recordVectors.kind, recordVectors.title).limit(50).offset(q.offset ?? 0);
  return { total: n, items: rows.map((r) => ({ kind: r.kind as RecordKind, refId: r.refId, companyId: r.companyId, title: r.title, text: r.text, link: r.link, indexed: !!r.embedding, excluded: r.excluded, error: r.error, indexedAt: r.indexedAt.toISOString() })) };
}

/* ---------------- hledání ---------------- */

/** Kdo smí vidět který záznam: druh (a u výjimky její poddruh) → povolené společnosti. */
export type RecordAccess = { kinds: Partial<Record<RecordKind, string[]>>; exceptionSub: Record<string, string[]> };

type Row = { kind: string; ref_id: string; company_id: string; title: string; text: string; link: string; meta: Record<string, string | number | null>; dist?: number };

const visibleRow = (a: RecordAccess, r: { kind: string; company_id: string; meta: Record<string, unknown> }) =>
  r.kind === "exception" ? (a.exceptionSub[String(r.meta.sub)] ?? []).includes(r.company_id) : (a.kinds[r.kind as RecordKind] ?? []).includes(r.company_id);

const toHit = (r: Row, score: number): RecordHit => ({ kind: r.kind as RecordKind, refId: r.ref_id, companyId: r.company_id, title: r.title, snippet: recordSnippet(r.text), link: r.link, score: Math.round(score * 1000) / 1000, meta: r.meta });

function allowedCompanies(a: RecordAccess) {
  return [...new Set([...Object.values(a.kinds).flat(), ...Object.values(a.exceptionSub).flat()])];
}

/** Hledání podle významu (+ doplňkově podle slov); vrací i plné texty pro odpovědi AI. */
export async function searchRecords(db: Db, config: Config, q: string, access: RecordAccess, opts: { kinds?: RecordKind[]; limit?: number } = {}, fetchImpl?: FetchLike): Promise<{ hits: (RecordHit & { text: string })[]; mode: "semantic" | "keyword" }> {
  const companies = allowedCompanies(access);
  const kinds = (opts.kinds?.length ? opts.kinds : [...RECORD_KINDS]).filter((k) => (k === "exception" ? Object.values(access.exceptionSub).some((x) => x.length) : (access.kinds[k]?.length ?? 0) > 0));
  const limit = opts.limit ?? 12;
  if (!companies.length || !kinds.length || !q.trim()) return { hits: [], mode: "keyword" };
  const s = await getAiSettings(db);
  const model = s.enabled && s.recordSearchEnabled ? s.embeddingModel : null;
  const scored = new Map<string, { row: Row; score: number }>();
  let mode: "semantic" | "keyword" = "keyword";
  if (model) {
    try {
      const [qv] = await clientFor(s, config, fetchImpl).embed([q]);
      const cs = cosine("embedding", qv!);
      const rows = await db.execute<Row>(sql`
        select kind, ref_id, company_id, title, text, link, meta, ${cs.dist} as dist
        from record_vectors
        where model = ${model} and embedding is not null and ${cs.dims} and not excluded
          and company_id in (${sql.join(companies.map((x) => sql`${x}::uuid`), sql`, `)})
          and kind in (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})
        order by dist asc limit ${limit * 4}`);
      for (const r of rows) if (visibleRow(access, r)) scored.set(`${r.kind}:${r.ref_id}`, { row: r, score: 1 - Number(r.dist) });
      mode = "semantic";
    } catch (e) {
      console.error("Embedding dotazu (záznamy):", (e as Error).message);
    }
  }
  // slova (CVE, kódy, přesné termíny) – fulltext s předponami (v1.07) posílí nebo nahradí vektory
  const words = [...new Set(normalizeSearch(q).split(/[^\p{L}\p{N}-]+/u).filter((w) => w.length >= 3))].slice(0, 8);
  const tsq = prefixTsQuery(words);
  if (tsq) {
    const ft = await db.execute<Row & { rank: number }>(sql`
      select kind, ref_id, company_id, title, text, link, meta, ts_rank(search_tsv, to_tsquery('simple', ${tsq})) as rank
      from record_vectors
      where not excluded and search_tsv @@ to_tsquery('simple', ${tsq})
        and company_id in (${sql.join(companies.map((x) => sql`${x}::uuid`), sql`, `)})
        and kind in (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})
      order by rank desc limit 200`);
    const top = Math.max(0.0001, ...[...ft].map((r) => Number(r.rank)));
    for (const k of ft) {
      if (!visibleRow(access, k)) continue;
      const rel = Number(k.rank) / top;
      const key = `${k.kind}:${k.ref_id}`;
      const prev = scored.get(key);
      if (prev) prev.score += 0.15 * rel;
      else scored.set(key, { row: k, score: (mode === "semantic" ? 0.3 : 0.5) * rel });
    }
  }
  if (words.length && !tsq) {
    const kw = await db
      .select({ kind: recordVectors.kind, ref_id: recordVectors.refId, company_id: recordVectors.companyId, title: recordVectors.title, text: recordVectors.text, link: recordVectors.link, meta: recordVectors.meta, search: recordVectors.searchText })
      .from(recordVectors)
      .where(
        and(
          inArray(recordVectors.companyId, companies),
          inArray(recordVectors.kind, kinds),
          eq(recordVectors.excluded, false),
          sql`(${sql.join(words.map((w) => sql`${recordVectors.searchText} like ${`%${w.replace(/[\\%_]/g, (m) => `\\${m}`)}%`}`), sql` or `)})`,
        ),
      )
      .limit(200);
    for (const k of kw) {
      if (!visibleRow(access, k)) continue;
      const matched = words.filter((w) => k.search.includes(w)).length / words.length;
      const key = `${k.kind}:${k.ref_id}`;
      const prev = scored.get(key);
      if (prev) prev.score += 0.15 * matched;
      else scored.set(key, { row: k, score: (mode === "semantic" ? 0.3 : 0.5) * matched });
    }
  }
  const hits = [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row, score }) => ({ ...toHit(row, Math.min(1, score)), text: row.text }));
  return { hits, mode };
}

/** Nejpodobnější záznamy k danému záznamu (všechny druhy, které uživatel smí vidět). */
export async function similarRecords(db: Db, kind: RecordKind, refId: string, access: RecordAccess, limit = 8): Promise<{ indexed: boolean; hits: RecordHit[] }> {
  const s = await getAiSettings(db);
  const model = s.enabled && s.recordSearchEnabled ? s.embeddingModel : null;
  const [self] = await db
    .select({ id: recordVectors.id })
    .from(recordVectors)
    .where(and(eq(recordVectors.kind, kind), eq(recordVectors.refId, refId), isNotNull(recordVectors.embedding), model ? eq(recordVectors.model, model) : sql`false`));
  if (!self) return { indexed: false, hits: [] };
  const companies = allowedCompanies(access);
  if (!companies.length) return { indexed: true, hits: [] };
  const rows = await db.execute<Row>(sql`
    select o.kind, o.ref_id, o.company_id, o.title, o.text, o.link, o.meta, (o.embedding <=> s.embedding) as dist
    from record_vectors s join record_vectors o on o.id <> s.id and o.model = s.model and o.embedding is not null and not o.excluded and vector_dims(o.embedding) = vector_dims(s.embedding)
    where s.id = ${self.id} and o.company_id in (${sql.join(companies.map((x) => sql`${x}::uuid`), sql`, `)})
    order by dist asc limit ${limit * 3}`);
  return {
    indexed: true,
    hits: [...rows]
      .filter((r) => visibleRow(access, r) && 1 - Number(r.dist) >= 0.45)
      .slice(0, limit)
      .map((r) => toHit(r, 1 - Number(r.dist))),
  };
}
