import { cosine } from "../../lib/vector";
import type { DocIndexStatusDto, DocQaAnswerDto, DocQaSource } from "@contix/shared";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { docChunks, docIndexState, policies, policyFiles, policyVersions } from "../../db/schema";
import type { FetchLike } from "../discovery/connectors/wazuh";
import { clientFor, getAiSettings } from "../ai/service";
import { fileKind, normalizeSearch } from "./convert";

/* ============================================================
 * Zeptej se dokumentace (ADR-028): platné verze dokumentů se rozdělí na úseky, úseky dostanou vektor
 * (embedding na lokálním modelu, např. bge-m3) a otázka se zodpoví jen z nalezených úseků s citacemi.
 * Indexují se jen platné verze – návrhy se do odpovědí nikdy nedostanou.
 * ============================================================ */

const CHUNK_MAX = 1100;
const CHUNK_MIN = 200;
const EMBED_BATCH = 16;
const TOP_K = 6;

export interface Chunk {
  source: string;
  ordinal: number;
  heading: string | null;
  text: string;
}

/** Řádek vypadá jako nadpis / článek (Markdown #, „Článek 3“, „2.1 Hesla“, krátký řádek VELKÝMI). */
const isHeading = (l: string) =>
  /^#{1,6}\s+\S/.test(l) || (/^((čl\.|článek|část|kapitola|hlava)\s*\d+|\d+(\.\d+)*\.?\s+\p{Lu})/iu.test(l) && l.length < 120) || (l.length < 80 && l.length > 3 && l === l.toUpperCase() && /\p{Lu}/u.test(l));

/** Rozdělí text na úseky po odstavcích (max. ~1100 znaků) s nejbližším nadpisem. */
export function chunkText(text: string, source: string): Chunk[] {
  const out: Chunk[] = [];
  let heading: string | null = null;
  let buf: string[] = [];
  let bufHeading: string | null = null;
  const flush = () => {
    const t = buf.join("\n").trim();
    if (t) out.push({ source, ordinal: out.length, heading: bufHeading, text: t });
    buf = [];
  };
  for (const raw of text.split(/\n+/)) {
    const l = raw.replace(/\s+/g, " ").trim();
    if (!l) continue;
    if (isHeading(l)) {
      // nový nadpis uzavře dostatečně velký úsek
      if (buf.join(" ").length >= CHUNK_MIN) flush();
      heading = l.replace(/^#+\s*/, "").slice(0, 300);
      if (!buf.length) bufHeading = heading;
      buf.push(l.replace(/^#+\s*/, ""));
      continue;
    }
    if (buf.join(" ").length + l.length > CHUNK_MAX && buf.length) {
      flush();
      bufHeading = heading;
    }
    if (!buf.length) bufHeading = heading;
    // velmi dlouhý odstavec (tabulka z Excelu, PDF bez odstavců) rozdělit po větách
    if (l.length > CHUNK_MAX) {
      for (const part of l.match(new RegExp(`.{1,${CHUNK_MAX}}(\\s|$)`, "gu")) ?? [l]) {
        buf.push(part.trim());
        flush();
        bufHeading = heading;
      }
      continue;
    }
    buf.push(l);
  }
  flush();
  return out;
}

/** Texty platné verze: text v CONTIXu + soubory (Word a jeho PDF export se nepočítají dvakrát). */
async function versionSources(db: Db, versionId: string) {
  const [v] = await db.select({ content: policyVersions.content }).from(policyVersions).where(eq(policyVersions.id, versionId));
  const files = await db
    .select({ filename: policyFiles.filename, mime: policyFiles.mime, text: policyFiles.text })
    .from(policyFiles)
    .where(and(eq(policyFiles.versionId, versionId), isNull(policyFiles.supersededAt)))
    .orderBy(asc(policyFiles.uploadedAt));
  const base = (n: string) => n.replace(/\.[^.]+$/, "").toLowerCase();
  const office = new Set(files.filter((f) => f.text && fileKind(f.filename, f.mime) === "office").map((f) => base(f.filename)));
  const out: { source: string; text: string }[] = [];
  // Markdown: nadpisy ponechat jako řádky (rozpoznají se jako nadpis), zvýraznění odstranit
  if (v?.content) out.push({ source: "text verze", text: v.content.replace(/\*\*|__|`/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") });
  for (const f of files) if (f.text && !(fileKind(f.filename, f.mime) === "pdf" && office.has(base(f.filename)))) out.push({ source: f.filename, text: f.text });
  return out;
}

const hashOf = (parts: { source: string; text: string }[]) => createHash("sha256").update(parts.map((p) => `${p.source}\n${p.text}`).join("\n\f")).digest("hex");

/** Zaindexuje platnou verzi dokumentu (nebo odstraní index, pokud dokument není platný). */
export async function indexPolicy(db: Db, config: Config, policyId: string, fetchImpl?: FetchLike): Promise<void> {
  const s = await getAiSettings(db);
  const [p] = await db.select({ id: policies.id, companyId: policies.companyId, status: policies.status, disposedAt: policies.disposedAt }).from(policies).where(eq(policies.id, policyId));
  const [cur] = p ? await db.select({ id: policyVersions.id }).from(policyVersions).where(and(eq(policyVersions.policyId, policyId), eq(policyVersions.status, "approved"))) : [];
  if (!p || p.status !== "active" || p.disposedAt || !cur) {
    await db.delete(docChunks).where(eq(docChunks.policyId, policyId));
    if (p) await db.delete(docIndexState).where(eq(docIndexState.policyId, policyId));
    return;
  }
  const sources = await versionSources(db, cur.id);
  const sourceHash = hashOf(sources);
  const chunks = sources.flatMap((x) => chunkText(x.text, x.source)).map((c, i) => ({ ...c, ordinal: i }));
  const useModel = s.enabled && s.docQaEnabled ? s.embeddingModel : null;
  let vectors: (number[] | null)[] = chunks.map(() => null);
  let error: string | null = null;
  if (useModel && chunks.length) {
    try {
      const client = clientFor(s, config, fetchImpl);
      vectors = [];
      for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
        const batch = chunks.slice(i, i + EMBED_BATCH);
        // nadpis + text – úsek nese i kontext článku
        vectors.push(...(await client.embed(batch.map((c) => (c.heading && !c.text.startsWith(c.heading) ? `${c.heading}\n${c.text}` : c.text)))));
      }
    } catch (e) {
      error = (e as Error).message.slice(0, 500);
      vectors = chunks.map(() => null);
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(docChunks).where(eq(docChunks.policyId, policyId));
    for (let i = 0; i < chunks.length; i += 200)
      await tx.insert(docChunks).values(
        chunks.slice(i, i + 200).map((c, k) => ({
          companyId: p.companyId,
          policyId,
          versionId: cur.id,
          source: c.source.slice(0, 255),
          ordinal: c.ordinal,
          heading: c.heading?.slice(0, 300) ?? null,
          text: c.text,
          searchText: normalizeSearch(c.text),
          embedding: vectors[i + k] ?? null,
          model: vectors[i + k] ? useModel : null,
        })),
      );
    const state = { versionId: cur.id, model: error ? null : useModel, chunks: chunks.length, sourceHash, indexedAt: new Date(), error };
    await tx.insert(docIndexState).values({ policyId, ...state }).onConflictDoUpdate({ target: docIndexState.policyId, set: state });
  });
}

/** Dokumenty, jejichž index neodpovídá platné verzi, modelu nebo textům souborů. */
/** Chybné indexace se v plánovači zkouší znovu nejdříve po hodině (ať se AI server nezahlcuje); ruční přeindexování hned. */
const ERROR_RETRY_MS = 60 * 60_000;

async function staleOnes(db: Db, model: string | null, retryErrors = false) {
  const rows = await db
    .select({ id: policies.id, versionId: policyVersions.id, st: docIndexState })
    .from(policies)
    .innerJoin(policyVersions, and(eq(policyVersions.policyId, policies.id), eq(policyVersions.status, "approved")))
    .leftJoin(docIndexState, eq(docIndexState.policyId, policies.id))
    .where(and(eq(policies.status, "active"), isNull(policies.disposedAt)));
  const out: string[] = [];
  for (const r of rows) {
    const errorDue = !!r.st?.error && (retryErrors || !r.st.indexedAt || Date.now() - r.st.indexedAt.getTime() > ERROR_RETRY_MS);
    if (!r.st || r.st.versionId !== r.versionId || (model && r.st.model !== model && !r.st.error) || errorDue) {
      out.push(r.id);
      continue;
    }
    // text souboru doplněný až po indexaci (převodní služba) → přeindexovat
    if (!r.st.error && r.st.sourceHash !== hashOf(await versionSources(db, r.versionId))) out.push(r.id);
  }
  // zrušené / skartované dokumenty – smazat index
  const orphan = await db
    .select({ id: docIndexState.policyId })
    .from(docIndexState)
    .innerJoin(policies, eq(policies.id, docIndexState.policyId))
    .where(sql`${policies.status} <> 'active' or ${policies.disposedAt} is not null`);
  return [...out, ...orphan.map((o) => o.id)];
}

/** Plánovač: přeindexuje zastaralé dokumenty (s časovým limitem). */
export async function processDocIndex(db: Db, config: Config, maxMs = 5 * 60_000, fetchImpl?: FetchLike, retryErrors = false): Promise<number> {
  const s = await getAiSettings(db);
  const model = s.enabled && s.docQaEnabled ? s.embeddingModel : null;
  const until = Date.now() + maxMs;
  let n = 0;
  for (const id of await staleOnes(db, model, retryErrors)) {
    if (Date.now() > until) break;
    await indexPolicy(db, config, id, fetchImpl).catch((e) => console.error("Indexace dokumentu:", (e as Error).message));
    n++;
  }
  return n;
}

export async function indexStatus(db: Db, companyIds: string[]): Promise<DocIndexStatusDto> {
  const s = await getAiSettings(db);
  const model = s.enabled && s.docQaEnabled ? s.embeddingModel : null;
  if (!companyIds.length) return { enabled: !!model, embeddingModel: s.embeddingModel, documents: 0, indexed: 0, pending: 0, chunks: 0, lastIndexedAt: null, errors: [] };
  const docs = await db
    .select({ id: policies.id, title: policies.title, code: policies.code, versionId: policyVersions.id, st: docIndexState })
    .from(policies)
    .innerJoin(policyVersions, and(eq(policyVersions.policyId, policies.id), eq(policyVersions.status, "approved")))
    .leftJoin(docIndexState, eq(docIndexState.policyId, policies.id))
    .where(and(eq(policies.status, "active"), isNull(policies.disposedAt), inArray(policies.companyId, companyIds)));
  const ok = docs.filter((d) => d.st && d.st.versionId === d.versionId && (!model || d.st.model === model) && !d.st.error);
  return {
    enabled: !!model,
    embeddingModel: s.embeddingModel,
    documents: docs.length,
    indexed: ok.length,
    pending: docs.length - ok.length,
    chunks: docs.reduce((a, d) => a + (d.st?.chunks ?? 0), 0),
    lastIndexedAt: docs.map((d) => d.st?.indexedAt?.toISOString() ?? "").sort().at(-1) || null,
    errors: docs.filter((d) => d.st?.error).map((d) => ({ policyId: d.id, title: `${d.code ? `${d.code} ` : ""}${d.title}`, error: d.st!.error! })),
  };
}

const SYSTEM = `Jsi asistent, který odpovídá zaměstnancům organizace na otázky podle jejích interních předpisů (bezpečnostní politika, směrnice, postupy).
Pravidla:
- Odpovídej VÝHRADNĚ z poskytnutých úryvků dokumentů. Nic si nedomýšlej, nepoužívej obecné znalosti.
- Každé tvrzení doplň odkazem na úryvek ve tvaru [1], [2] podle čísla úryvku.
- Pokud úryvky odpověď neobsahují, napiš jen: „V platné dokumentaci jsem odpověď nenašel.“ a případně doporuč, komu se obrátit (gestor dokumentu).
- Odpovídej česky, stručně a věcně (nejvýše několik vět nebo krátký seznam).
- Pokud se úryvky liší (různé dokumenty říkají něco jiného), upozorni na to.`;

export type Hit = { id: string; policyId: string; text: string; heading: string | null; source: string; score: number };

/** Vyhledání úseků platné dokumentace (vektory + slova), jen dokumenty, které uživatel smí číst; bez volání chatu. */
export async function retrieveDocChunks(
  db: Db,
  config: Config,
  input: { question: string; companyIds: string[]; visible: (policyId: string) => Promise<boolean>; topK?: number },
  fetchImpl?: FetchLike,
): Promise<{ picked: Hit[]; mode: DocQaAnswerDto["mode"] }> {
  const s = await getAiSettings(db);
  const topK = input.topK ?? TOP_K;
  if (!input.companyIds.length) return { picked: [], mode: "keyword" };
  const client = clientFor(s, config, fetchImpl);
  let mode: DocQaAnswerDto["mode"] = "semantic";
  let hits: Hit[] = [];
  try {
    const [qv] = await client.embed([input.question]);
    const cs = cosine("embedding", qv!);
    const rows = await db.execute<{ id: string; policy_id: string; text: string; heading: string | null; source: string; dist: number }>(sql`
      select id, policy_id, text, heading, source, ${cs.dist} as dist
      from doc_chunks
      where model = ${s.embeddingModel} and embedding is not null and company_id in (${sql.join(input.companyIds.map((x) => sql`${x}::uuid`), sql`, `)})
        and ${cs.dims}
      order by dist asc limit 40`);
    hits = [...rows].map((r) => ({ id: r.id, policyId: r.policy_id, text: r.text, heading: r.heading, source: r.source, score: 1 - Number(r.dist) }));
  } catch (e) {
    console.error("Embedding dotazu:", (e as Error).message);
    mode = "keyword";
  }
  // doplňkové hledání slov (přesné termíny, čísla článků) – a náhrada, když embedding není k dispozici
  const words = [...new Set(normalizeSearch(input.question).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4))].slice(0, 8);
  if (words.length) {
    const kw = await db
      .select({ id: docChunks.id, policyId: docChunks.policyId, text: docChunks.text, heading: docChunks.heading, source: docChunks.source, search: docChunks.searchText })
      .from(docChunks)
      .where(and(inArray(docChunks.companyId, input.companyIds), sql`(${sql.join(words.map((w) => sql`${docChunks.searchText} like ${`%${w.replace(/[\\%_]/g, (m) => `\\${m}`)}%`}`), sql` or `)})`))
      .limit(200);
    for (const k of kw) {
      const matched = words.filter((w) => k.search.includes(w)).length / words.length;
      const prev = hits.find((h) => h.id === k.id);
      if (prev) prev.score += 0.15 * matched;
      else hits.push({ id: k.id, policyId: k.policyId, text: k.text, heading: k.heading, source: k.source, score: (mode === "semantic" ? 0.3 : 0.5) * matched });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  // jen dokumenty, které uživatel smí číst; nejvýše 3 úseky z jednoho dokumentu
  const allowed = new Map<string, boolean>();
  const picked: Hit[] = [];
  for (const h of hits) {
    if (picked.length >= topK) break;
    if (!allowed.has(h.policyId)) allowed.set(h.policyId, await input.visible(h.policyId));
    if (!allowed.get(h.policyId)) continue;
    if (picked.filter((p) => p.policyId === h.policyId).length >= 3) continue;
    picked.push(h);
  }
  return { picked, mode };
}

/** Metadata dokumentů (označení, název, platná verze) k nalezeným úsekům. */
export async function docMeta(db: Db, policyIds: string[]) {
  if (!policyIds.length) return new Map<string, { id: string; code: string | null; title: string; version: string }>();
  const meta = await db
    .select({ id: policies.id, code: policies.code, title: policies.title, version: policyVersions.version })
    .from(policies)
    .innerJoin(policyVersions, and(eq(policyVersions.policyId, policies.id), eq(policyVersions.status, "approved")))
    .where(inArray(policies.id, [...new Set(policyIds)]));
  return new Map(meta.map((m) => [m.id, m]));
}

/**
 * Otázka nad platnou dokumentací. `visible(policyId)` určuje, které dokumenty smí uživatel číst
 * (stejná pravidla jako portál) – úseky jiných dokumentů se modelu nikdy nepošlou.
 */
export async function askDocs(
  db: Db,
  config: Config,
  input: { question: string; companyIds: string[]; visible: (policyId: string) => Promise<boolean> },
  fetchImpl?: FetchLike,
): Promise<DocQaAnswerDto> {
  const t0 = Date.now();
  const s = await getAiSettings(db);
  if (!s.enabled || !s.docQaEnabled) throw new Error("Zeptej se dokumentace není zapnuté (Administrace → AI asistent).");
  if (!input.companyIds.length) return { answer: "V platné dokumentaci jsem odpověď nenašel.", sources: [], mode: "keyword", model: null, durationMs: 0 };
  const client = clientFor(s, config, fetchImpl);
  const { picked, mode } = await retrieveDocChunks(db, config, input, fetchImpl);
  if (!picked.length) return { answer: "V platné dokumentaci jsem odpověď nenašel.", sources: [], mode, model: null, durationMs: Date.now() - t0 };

  const metaOf = await docMeta(db, picked.map((p) => p.policyId));
  const sources: DocQaSource[] = picked.map((h, i) => {
    const m = metaOf.get(h.policyId)!;
    return { n: i + 1, policyId: h.policyId, code: m?.code ?? null, title: m?.title ?? "?", version: m?.version ?? "?", heading: h.heading, source: h.source, snippet: h.text.length > 400 ? `${h.text.slice(0, 400)}…` : h.text };
  });
  const context = picked
    .map((h, i) => {
      const m = metaOf.get(h.policyId);
      return `[${i + 1}] ${m?.code ? `${m.code} ` : ""}${m?.title ?? ""} (verze ${m?.version ?? "?"})${h.heading ? `, ${h.heading}` : ""}:\n${h.text}`;
    })
    .join("\n\n");
  const r = await client.chat([
    { role: "system", content: s.instructions ? `${SYSTEM}\n${s.instructions}` : SYSTEM },
    { role: "user", content: `Úryvky z platné dokumentace:\n\n${context}\n\nOtázka: ${input.question}` },
  ]);
  const answer = r.text.replace(/<think>[\s\S]*?<\/think>/g, "").trim() || "V platné dokumentaci jsem odpověď nenašel.";
  // ponechat jen citované zdroje (v pořadí čísel), nepoužité nezobrazovat
  const cited = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  return { answer, sources: cited.size ? sources.filter((x) => cited.has(x.n)) : sources, mode, model: r.model, durationMs: Date.now() - t0 };
}

