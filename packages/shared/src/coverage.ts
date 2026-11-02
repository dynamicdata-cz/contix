import { z } from "zod";
import type { GapStatus } from "./ai";
import type { Compliance, ControlStatus } from "./controls";
import { FrameworkIdSchema, type FrameworkId } from "./frameworks";

/* ============================================================
 * Pokrytí předpisu (v0.42, ADR-038): matice ustanovení × dokumenty × opatření.
 * - dokument pokrývá požadavek přes oddíl vyhlášky (bezpečnostní dokumentace, jen vyhláška režimu) nebo navázaný požadavek,
 * - AI verdikt = poslední dokončené skóre dokumentu (policy_review) lokálním modelem; „zastaralý“ = hodnocena jiná verze,
 * - opatření a míra shody z katalogu opatření (stejně jako SoA),
 * - snímek = neměnný stav matice k datu (doklad pro audit).
 * Nic se nepersistuje kromě snímků – stav se počítá při čtení.
 * ============================================================ */

export const COVERAGE_GAPS = ["no_document", "ai_missing", "ai_partial", "no_control", "not_compliant"] as const;
export type CoverageGap = (typeof COVERAGE_GAPS)[number];

export const COVERAGE_LABELS = {
  gap: {
    no_document: "Žádný dokument",
    ai_missing: "AI: v dokumentech chybí",
    ai_partial: "AI: pokryto částečně",
    no_control: "Žádné opatření",
    not_compliant: "Opatření nesplňuje",
  } satisfies Record<CoverageGap, string>,
  docState: { none: "Bez dokumentu", unscored: "Neohodnoceno", covered: "Pokryto", partial: "Částečně", missing: "Chybí" },
};

export interface CoverageDoc {
  id: string;
  code: string | null;
  title: string;
  status: "draft" | "active";
  /** Vazba: oddíl vyhlášky (section) nebo navázaný požadavek (link). */
  via: "section" | "link";
  ai: GapStatus | null;
  /** AI hodnotila starší verzi dokumentu. */
  aiStale: boolean;
  aiReason: string | null;
  aiAt: string | null;
}

export type CoverageDocState = "none" | "unscored" | GapStatus;

export interface CoverageRow {
  id: string;
  section: string;
  sectionTitle: string;
  ref: string;
  text: string;
  applicable: boolean;
  compliance: Compliance;
  controls: { id: string; code: string | null; name: string; status: ControlStatus; inherited?: boolean }[];
  docs: CoverageDoc[];
  /** Nejlepší AI verdikt mezi dokumenty (pokryto > částečně > chybí), „unscored“ = dokumenty bez hodnocení. */
  docState: CoverageDocState;
  gaps: CoverageGap[];
}

export interface CoverageSummary {
  total: number;
  applicable: number;
  withDocs: number;
  aiCovered: number;
  aiPartial: number;
  aiMissing: number;
  unscored: number;
  withControls: number;
  compliant: number;
  withGaps: number;
  /** Skóre pokrytí dokumentací (AI): pokryto 1, částečně 0,5, ostatní 0 – z použitelných požadavků. */
  docScore: number | null;
}

export interface CoverageDto {
  framework: FrameworkId;
  rows: CoverageRow[];
  summary: CoverageSummary;
  /** Dokumenty, které se týkají rámce, a stav jejich AI hodnocení. */
  documents: { id: string; code: string | null; title: string; status: "draft" | "active"; requirements: number; scored: boolean; stale: boolean; score: number | null }[];
}

export interface CoverageBatchStatus {
  running: boolean;
  framework: FrameworkId | null;
  total: number;
  done: number;
  failed: number;
  current: string | null;
  errors: { document: string; error: string }[];
  startedAt: string | null;
  finishedAt: string | null;
}

export interface CoverageSnapshotDto {
  id: string;
  framework: FrameworkId;
  note: string | null;
  summary: CoverageSummary;
  createdAt: string;
  createdByName: string | null;
}
export interface CoverageSnapshotDetail extends CoverageSnapshotDto {
  rows: CoverageRow[];
}

export const CoverageScoreInput = z.object({
  framework: FrameworkIdSchema,
  /** Jen dokumenty bez hodnocení nebo s hodnocením starší verze (výchozí), jinak všechny. */
  onlyStale: z.boolean().default(true),
});
export type CoverageScoreInput = z.input<typeof CoverageScoreInput>;
export const CoverageSnapshotInput = z.object({ framework: FrameworkIdSchema, note: z.string().trim().max(2000).nullable().optional() });
export type CoverageSnapshotInput = z.input<typeof CoverageSnapshotInput>;

const RANK: Record<GapStatus, number> = { covered: 3, partial: 2, missing: 1 };

/** Nejlepší AI verdikt mezi dokumenty – stačí jeden dokument, který požadavek pokrývá. */
export function bestDocState(docs: Pick<CoverageDoc, "ai">[]): CoverageDocState {
  if (!docs.length) return "none";
  const scored = docs.map((d) => d.ai).filter((x): x is GapStatus => !!x);
  if (!scored.length) return "unscored";
  return scored.sort((a, b) => RANK[b] - RANK[a])[0]!;
}

/** Mezery u použitelného požadavku (neaplikovatelný = bez mezer). */
export function coverageGaps(r: Pick<CoverageRow, "applicable" | "docs" | "docState" | "controls" | "compliance">): CoverageGap[] {
  if (!r.applicable) return [];
  const out: CoverageGap[] = [];
  if (!r.docs.length) out.push("no_document");
  else if (r.docState === "missing") out.push("ai_missing");
  else if (r.docState === "partial") out.push("ai_partial");
  if (!r.controls.length) out.push("no_control");
  else if (r.compliance === "non_compliant" || r.compliance === "partial") out.push("not_compliant");
  return out;
}

export function summarizeCoverage(rows: CoverageRow[]): CoverageSummary {
  const app = rows.filter((r) => r.applicable);
  const n = (f: (r: CoverageRow) => boolean) => app.filter(f).length;
  const pts = app.reduce((s, r) => s + (r.docState === "covered" ? 1 : r.docState === "partial" ? 0.5 : 0), 0);
  return {
    total: rows.length,
    applicable: app.length,
    withDocs: n((r) => r.docs.length > 0),
    aiCovered: n((r) => r.docState === "covered"),
    aiPartial: n((r) => r.docState === "partial"),
    aiMissing: n((r) => r.docState === "missing"),
    unscored: n((r) => r.docState === "unscored"),
    withControls: n((r) => r.controls.length > 0),
    compliant: n((r) => r.compliance === "compliant"),
    withGaps: n((r) => r.gaps.length > 0),
    docScore: app.length ? Math.round((pts / app.length) * 100) : null,
  };
}
