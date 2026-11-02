import { z } from "zod";
/* ============================================================
 * Hledání v záznamech podle významu (ADR-044): vektorový index rizik, zranitelností, incidentů a výjimek
 * (embedding na lokálním modelu, např. bge-m3) – sémantické hledání, podobné záznamy, odpovědi AI s odkazy.
 * ============================================================ */

export const RECORD_KINDS = [
  "risk",
  "vulnerability",
  "incident",
  "exception",
  "audit_finding",
  "ai_system",
  "cra_finding",
  // v1.07 (ADR-103): znalostní báze
  "control",
  "asset",
  "process",
  "supplier",
  "legal_review",
  "qa_answer",
  "knowledge",
] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export const RECORD_LABELS: Record<RecordKind, string> = {
  risk: "Riziko",
  vulnerability: "Zranitelnost",
  incident: "Incident",
  exception: "Výjimka",
  audit_finding: "Zjištění auditu",
  ai_system: "AI systém",
  cra_finding: "Zranitelnost produktu",
  control: "Opatření",
  asset: "Aktivum",
  process: "Proces",
  supplier: "Dodavatel",
  legal_review: "Posouzení změny předpisu",
  qa_answer: "Schválená odpověď (dotazníky)",
  knowledge: "Znalostní článek",
};

export interface RecordHit {
  kind: RecordKind;
  refId: string;
  companyId: string;
  title: string;
  snippet: string;
  link: string;
  /** Podobnost 0–1 (kosinová; u hledání slov odhad). */
  score: number;
  meta: Record<string, string | number | null>;
}

export interface RecordSearchResult {
  hits: RecordHit[];
  /** semantic = vektory, keyword = jen hledání slov (embedding nedostupný / vypnutý). */
  mode: "semantic" | "keyword";
}

export interface RecordSimilarResult {
  /** Záznam nemá vektor (ještě nezaindexován / vypnuto). */
  indexed: boolean;
  hits: RecordHit[];
}

export interface RecordAskSource extends RecordHit {
  n: number;
}

export interface RecordAskAnswer {
  answer: string;
  sources: RecordAskSource[];
  mode: "semantic" | "keyword";
  model: string | null;
  durationMs: number;
}

export interface RecordIndexStatusDto {
  enabled: boolean;
  embeddingModel: string;
  byKind: Record<RecordKind, { records: number; indexed: number; excluded?: number }>;
  /** Vypnuté druhy (správa indexu, v1.07). */
  disabledKinds?: RecordKind[];
  /** Záznamy čekající na výpočet vektoru. */
  pending?: number;
  /** Indexace právě běží (spuštěná ručně). */
  running?: boolean;
  lastIndexedAt: string | null;
  errors: number;
}

/** Úryvek textu záznamu pro zobrazení (bez prvního řádku = název). */
export function recordSnippet(text: string, max = 260): string {
  const body = text.split("\n").slice(1).join(" · ").replace(/\s+/g, " ").trim();
  return body.length > max ? `${body.slice(0, max)}…` : body;
}

/* ---------- správa indexu (v1.07, ADR-103) ---------- */
export const RecordIndexSettingsInput = z.object({ disabledKinds: z.array(z.enum(RECORD_KINDS)).max(RECORD_KINDS.length) });
export type RecordIndexSettings = z.infer<typeof RecordIndexSettingsInput>;
export interface RecordIndexItemDto {
  kind: RecordKind;
  refId: string;
  companyId: string;
  title: string;
  text: string;
  link: string;
  indexed: boolean;
  excluded: boolean;
  error: string | null;
  indexedAt: string;
}

/* ---------- znalostní články (v1.07, ADR-103) ---------- */
export const KNOWLEDGE_STATUSES = ["draft", "published"] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];
export const KnowledgeArticleInput = z.object({
  companyId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(300),
  body: z.string().max(100_000).default(""),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  status: z.enum(KNOWLEDGE_STATUSES).default("draft"),
});
export type KnowledgeArticleInput = z.input<typeof KnowledgeArticleInput>;
export interface KnowledgeArticleDto {
  id: string;
  companyId: string;
  title: string;
  body: string;
  tags: string[];
  status: KnowledgeStatus;
  updatedAt: string;
  updatedByName: string | null;
  canEdit: boolean;
}
export const KNOWLEDGE_LABELS = { status: { draft: "Koncept", published: "Zveřejněno" } satisfies Record<KnowledgeStatus, string> };

/** Úseky znalostního článku pro vektory: podle nadpisů ##, nejvýš ~1 500 znaků (v1.07). */
export function knowledgeChunks(title: string, body: string, max = 1500): { heading: string | null; text: string }[] {
  const out: { heading: string | null; text: string }[] = [];
  let heading: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    const t = buf.join("\n").trim();
    if (t) out.push({ heading, text: t });
    buf = [];
  };
  for (const line of body.split(/\r?\n/)) {
    const h = /^#{1,3}\s+(.+)$/.exec(line);
    if (h) {
      flush();
      heading = h[1]!.trim();
      continue;
    }
    if (buf.join("\n").length + line.length > max) flush();
    buf.push(line);
  }
  flush();
  return out.length ? out : [{ heading: null, text: title }];
}
