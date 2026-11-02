import { z } from "zod";
import { requirementById, requirementsOf, type FrameworkId } from "./frameworks";
import type { DiffPart } from "./policies";
import { patchOf } from "./zutil";

/* ============================================================
 * Legislativa (v0.34, ADR-035): sledované předpisy z e-Sbírky (REST API MV ČR) a ručně vedené normy,
 * časová znění, rozdíly mezi zněními, posouzení dopadu odpovědnou osobou a úkoly.
 *
 * Identita fragmentu (paragraf, odstavec, písmeno) = „klíč“ odvozený z citace (par_19-odst_1-pism_a),
 * NE interní ID fragmentu z e-Sbírky – ta se mohou se spuštěním e-Legislativy (2027) změnit.
 * ============================================================ */

export const LEGAL_SOURCES = ["esbirka", "manual", "eurlex"] as const;
export type LegalSource = (typeof LEGAL_SOURCES)[number];
export const LEGAL_REVIEW_STATUSES = ["new", "in_review", "assessed", "closed"] as const;
export type LegalReviewStatus = (typeof LEGAL_REVIEW_STATUSES)[number];
export const LEGAL_IMPACTS = ["none", "low", "medium", "high"] as const;
export type LegalImpact = (typeof LEGAL_IMPACTS)[number];
export const LEGAL_TASK_STATUSES = ["open", "done", "cancelled"] as const;
export type LegalTaskStatus = (typeof LEGAL_TASK_STATUSES)[number];
export const LEGAL_DIFF_KINDS = ["added", "removed", "modified"] as const;
export type LegalDiffKind = (typeof LEGAL_DIFF_KINDS)[number];

export const LEGAL_LABELS = {
  source: { esbirka: "e-Sbírka (API MV ČR)", manual: "Ručně vedený předpis / norma", eurlex: "EUR-Lex (předpisy EU)" } satisfies Record<LegalSource, string>,
  reviewStatus: { new: "Nové – k posouzení", in_review: "Posuzuje se", assessed: "Posouzeno", closed: "Uzavřeno" } satisfies Record<LegalReviewStatus, string>,
  impact: { none: "Bez dopadu", low: "Nízký", medium: "Střední", high: "Vysoký" } satisfies Record<LegalImpact, string>,
  taskStatus: { open: "Otevřený", done: "Splněno", cancelled: "Zrušeno" } satisfies Record<LegalTaskStatus, string>,
  diffKind: { added: "Nové", removed: "Zrušené", modified: "Změněné" } satisfies Record<LegalDiffKind, string>,
};

/** Doporučené předpisy ke sledování (kybernetická bezpečnost). */
export const LEGAL_SUGGESTED: { code: string; staleUrl: string; title: string }[] = [
  { code: "264/2025 Sb.", staleUrl: "/sb/2025/264", title: "Zákon o kybernetické bezpečnosti" },
  { code: "408/2025 Sb.", staleUrl: "/sb/2025/408", title: "Vyhláška o regulovaných službách" },
  { code: "409/2025 Sb.", staleUrl: "/sb/2025/409", title: "Vyhláška o bezpečnostních opatřeních – režim vyšších povinností" },
  { code: "410/2025 Sb.", staleUrl: "/sb/2025/410", title: "Vyhláška o bezpečnostních opatřeních – režim nižších povinností" },
];

/* ---------- předpisy EU (EUR-Lex / CELLAR, v0.39, ADR-037) ---------- */

export const EU_LANGS = ["cs", "en"] as const;
export type EuLang = (typeof EU_LANGS)[number];

/** Doporučené předpisy EU ke sledování (CELEX). */
export const EU_SUGGESTED: { celex: string; code: string; title: string }[] = [
  { celex: "32022L2555", code: "NIS2 – (EU) 2022/2555", title: "Směrnice o opatřeních k zajištění vysoké společné úrovně kybernetické bezpečnosti v Unii (NIS2)" },
  { celex: "32024R2690", code: "(EU) 2024/2690", title: "Prováděcí nařízení k NIS2 – technické a metodické požadavky na opatření" },
  { celex: "32022R2554", code: "DORA – (EU) 2022/2554", title: "Nařízení o digitální provozní odolnosti finančního sektoru (DORA)" },
  { celex: "32016R0679", code: "GDPR – (EU) 2016/679", title: "Obecné nařízení o ochraně osobních údajů (GDPR)" },
  { celex: "32024R1689", code: "AI Act – (EU) 2024/1689", title: "Akt o umělé inteligenci" },
  { celex: "32024R2847", code: "CRA – (EU) 2024/2847", title: "Akt o kybernetické odolnosti (CRA)" },
  { celex: "32014R0910", code: "eIDAS – (EU) 910/2014", title: "Nařízení o elektronické identifikaci a službách vytvářejících důvěru (eIDAS)" },
  { celex: "32022L2557", code: "CER – (EU) 2022/2557", title: "Směrnice o odolnosti kritických subjektů (CER)" },
];

const CELEX_RE = /^[1-9]\d{4}[A-Z]{1,2}\d{4}(?:\(\d{2}\))?$/;
const ELI_TYPE: Record<string, string> = { reg: "R", reg_impl: "R", reg_del: "R", dir: "L", dir_impl: "L", dir_del: "L", dec: "D", dec_impl: "D", dec_del: "D" };

/**
 * Číslo CELEX základního aktu z odkazu: „32022L2555“, „CELEX:32022L2555“, odkaz EUR-Lex (…?uri=CELEX:32022L2555),
 * ELI („http://data.europa.eu/eli/dir/2022/2555/oj“, „eli/reg_impl/2024/2690“). Konsolidované znění (0…-datum) → základní akt.
 */
export function celexOf(input: string): string | null {
  const t = decodeURIComponent(input.trim()).replace(/\s+/g, "");
  const m = t.match(/(?:CELEX[:=])?([0-9]{5}[A-Z]{1,2}[0-9]{4}(?:\(\d{2}\))?)(?:-\d{8})?/i);
  if (m) {
    let c = m[1]!.toUpperCase();
    if (c.startsWith("0")) c = `3${c.slice(1)}`;
    if (CELEX_RE.test(c)) return c;
  }
  const e = t.match(/eli\/([a-z_]+)\/(\d{4})\/(\d{1,4})/i);
  const type = e ? ELI_TYPE[e[1]!.toLowerCase()] : undefined;
  if (e && type) return `3${e[2]}${type}${e[3]!.padStart(4, "0")}`;
  return null;
}
/** Stálá identifikace předpisu EU v CONTIX: „/eu/cs/32022L2555“ (jazyk znění + CELEX). */
export const euStaleUrl = (celex: string, lang: EuLang = "cs") => `/eu/${lang}/${celex}`;
export function parseEuStaleUrl(u: string | null | undefined): { lang: EuLang; celex: string } | null {
  const m = u?.match(/^\/eu\/(cs|en)\/([0-9A-Z()]+)$/);
  return m && CELEX_RE.test(m[2]!) ? { lang: m[1] as EuLang, celex: m[2]! } : null;
}
/** „32022L2555“ → „(EU) 2022/2555“, „32014R0910“ → „(EU) 910/2014“ (do roku 2014 číslo/rok). */
export function codeOfCelex(celex: string): string {
  const m = celex.match(/^3(\d{4})([A-Z]{1,2})(\d{4})/);
  if (!m) return celex;
  const n = Number(m[3]);
  return Number(m[1]) < 2015 ? `(EU) ${n}/${m[1]}` : `(EU) ${m[1]}/${n}`;
}
/** Odkaz na předpis v EUR-Lex (jazyk znění). */
export const eurlexUrl = (celex: string, lang: EuLang = "cs") => `https://eur-lex.europa.eu/legal-content/${lang.toUpperCase()}/ALL/?uri=CELEX:${celex}`;

/** „264/2025 Sb.“, „264/2025“, „/sb/2025/264“, „/eli/cz/sb/2025/264/…“ → „/sb/2025/264“ (bez data znění). */
export function staleUrlOf(input: string): string | null {
  const t = input.trim();
  const m1 = t.match(/^(\d{1,4})\s*\/\s*(\d{4})(?:\s*Sb\.?)?$/i);
  if (m1) return `/sb/${m1[2]}/${Number(m1[1])}`;
  const m2 = t.match(/(?:^|\/)sb\/(\d{4})\/(\d{1,4})(?:\/|$|#)/i);
  if (m2) return `/sb/${m2[1]}/${Number(m2[2])}`;
  return null;
}
/** „/sb/2025/264“ → „264/2025 Sb.“ */
export const codeOfStaleUrl = (u: string) => {
  const m = u.match(/^\/sb\/(\d{4})\/(\d+)/);
  return m ? `${m[2]}/${m[1]} Sb.` : u;
};

/** Rámce CONTIX, které odpovídají předpisu (pro dohledání dotčených požadavků). */
export const ACT_FRAMEWORK: Record<string, FrameworkId> = {
  "/sb/2025/264": "zkb",
  "/sb/2025/409": "cz409",
  "/sb/2025/410": "cz410",
  "/eu/cs/32022R2554": "dora",
  "/eu/en/32022R2554": "dora",
  "/eu/cs/32022L2555": "nis2",
  "/eu/en/32022L2555": "nis2",
  "/eu/cs/32024R2690": "nis2",
  "/eu/en/32024R2690": "nis2",
};

/**
 * Klíč fragmentu z kotvy stálé URL („/sb/2025/264/2025-11-01#par_2-odst_3-pism_a“) nebo z citace
 * („§ 2 odst. 3 písm. a)“, „Čl. 5 odst. 2“, „5.2“). Vrací null, pokud nejde určit.
 */
export function fragmentKey(staleUrl: string | null | undefined, citation: string | null | undefined): string | null {
  const anchor = staleUrl?.includes("#") ? staleUrl.slice(staleUrl.indexOf("#") + 1).trim() : "";
  if (anchor && /^[a-z0-9_.\-]+$/i.test(anchor)) return anchor.toLowerCase();
  const c = (citation ?? "").replace(/\s+/g, " ");
  const parts: string[] = [];
  const par = c.match(/§\s*(\d+[a-z]?)/i);
  const art = c.match(/(?:čl\.|článek|článku|art\.?)\s*(\d+[a-z]?)/i);
  if (par) parts.push(`par_${par[1]!.toLowerCase()}`);
  else if (art) parts.push(`cl_${art[1]!.toLowerCase()}`);
  const odst = c.match(/odst\.\s*(\d+[a-z]?)/i);
  if (odst) parts.push(`odst_${odst[1]!.toLowerCase()}`);
  const pism = c.match(/písm\.\s*([a-z]{1,2})\)?/i);
  if (pism) parts.push(`pism_${pism[1]!.toLowerCase()}`);
  const bod = c.match(/bod(?:u|ě)?\s*(\d+)/i);
  if (bod) parts.push(`bod_${bod[1]}`);
  if (parts.length) return parts.join("-");
  const clause = c.match(/^(?:kap\.\s*)?([A-Z]?\.?\d+(?:\.\d+)*)\b/);
  return clause ? `k_${clause[1]!.replace(/^\./, "")}` : null;
}

/** Kandidáti na požadavek CONTIX pro fragment předpisu (od nejpřesnějšího): cz409:19/1/a → cz409:19/1 → cz409:19/a. */
export function requirementsForFragment(fw: FrameworkId, key: string): string[] {
  const base = key.replace(/~\d+$/, "");
  // kapitoly norem (k_5.2, k_A.5.15) → iso27001:5.2; u podkapitol i nadřazená (k_9.2.1 → 9.2.1, 9.2)
  const clause = base.match(/^k_([A-Z]?\.?\d+(?:\.\d+)*)$/i)?.[1];
  if (clause) {
    const parts = clause.replace(/^([A-Z])\.?/i, (_, a: string) => `${a.toUpperCase()}.`).split(".");
    const out: string[] = [];
    for (let n = parts.length; n >= 1; n--) {
      const id = `${fw}:${parts.slice(0, n).join(".")}`;
      if (requirementById(id)) {
        out.push(id);
        break;
      }
    }
    return out;
  }
  // NIS2: body přílohy 2024/2690 (priloha_1-bod_1.1.1 → nis2:P1.1.1, oddíl 1.1 → jeho body), odstavce směrnice (cl_21-odst_2 → písmena)
  if (fw === "nis2") {
    const pt = base.match(/^priloha_[0-9IVX]+-bod_(\d+(?:\.\d+)+)$/)?.[1];
    const para = base.match(/^cl_(\d+)-odst_(\d+)$/);
    const prefix = pt ? `nis2:P${pt}` : para ? `nis2:${para[1]}/${para[2]}` : null;
    if (!prefix) return [];
    if (requirementById(prefix)) return [prefix];
    return requirementsOf("nis2")
      .filter((r) => r.id.startsWith(pt ? `${prefix}.` : `${prefix}/`))
      .map((r) => r.id);
  }
  // články (cl_6 – DORA, nařízení EU) → dora:6
  const art = base.match(/^cl_(\d+)/)?.[1];
  if (art) return requirementById(`${fw}:${art}`) ? [`${fw}:${art}`] : [];
  const par = base.match(/par_(\d+)/)?.[1];
  if (!par) return [];
  const odst = base.match(/odst_(\d+)/)?.[1];
  const pism = base.match(/pism_([a-z]+)/)?.[1];
  const cands = [odst && pism ? `${fw}:${par}/${odst}/${pism}` : null, odst ? `${fw}:${par}/${odst}` : null, pism ? `${fw}:${par}/${pism}` : null, `${fw}:${par}`].filter((x): x is string => !!x);
  return cands.filter((id) => !!requirementById(id));
}

/** Prostý text z XHTML fragmentu (e-Sbírka) – bez značek, entity dekódované, mezery sjednocené. */
export function textOfXhtml(x: string): string {
  return x
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export interface LegalFragmentDto {
  key: string;
  label: string;
  text: string;
  depth: number;
  kind: string;
}

export interface LegalDiffItem {
  key: string;
  label: string;
  kind: LegalDiffKind;
  before: string | null;
  after: string | null;
  /** Rozdíl po slovech (jen u změněných). */
  parts?: DiffPart[];
  /** Dotčené požadavky CONTIX (ID). */
  requirementIds?: string[];
}

const norm = (t: string) => t.replace(/\s+/g, " ").trim();

/**
 * Rozdíl dvou znění po fragmentech (podle klíče). Fragmenty, které změnily jen klíč, ale text zůstal
 * (přečíslování / změna struktury dat zdroje), se neberou jako změna.
 */
export function diffFragments(before: LegalFragmentDto[], after: LegalFragmentDto[]): LegalDiffItem[] {
  const a = new Map(before.filter((f) => f.text).map((f) => [f.key, f]));
  const b = new Map(after.filter((f) => f.text).map((f) => [f.key, f]));
  const out: LegalDiffItem[] = [];
  const removed: LegalDiffItem[] = [];
  const added: LegalDiffItem[] = [];
  for (const [k, f] of b) {
    const old = a.get(k);
    if (!old) added.push({ key: k, label: f.label, kind: "added", before: null, after: f.text });
    else if (norm(old.text) !== norm(f.text)) out.push({ key: k, label: f.label, kind: "modified", before: old.text, after: f.text });
  }
  for (const [k, f] of a) if (!b.has(k)) removed.push({ key: k, label: f.label, kind: "removed", before: f.text, after: null });
  // stejný text pod jiným klíčem = jen změna identifikace, ne obsahu
  const removedByText = new Map<string, LegalDiffItem[]>();
  for (const r of removed) removedByText.set(norm(r.before!), [...(removedByText.get(norm(r.before!)) ?? []), r]);
  const keptAdded: LegalDiffItem[] = [];
  for (const x of added) {
    const same = removedByText.get(norm(x.after!));
    if (same?.length) same.pop();
    else keptAdded.push(x);
  }
  const keptRemoved = [...removedByText.values()].flat();
  const order = new Map(after.map((f, i) => [f.key, i]));
  const orderB = new Map(before.map((f, i) => [f.key, i]));
  return [...out, ...keptAdded, ...keptRemoved].sort((x, y) => (order.get(x.key) ?? orderB.get(x.key) ?? 0) - (order.get(y.key) ?? orderB.get(y.key) ?? 0));
}

/**
 * Ruční znění (norma, licencovaný text): rozdělí text na fragmenty podle nadpisů
 * („§ 5“, „Čl. 3“, „5.2 Název“, „A.5.15 Řízení přístupu“). Text před prvním nadpisem = „úvod“.
 */
export function splitManualText(text: string): LegalFragmentDto[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: LegalFragmentDto[] = [];
  let cur: LegalFragmentDto = { key: "uvod", label: "Úvod", text: "", depth: 0, kind: "uvod" };
  const head = /^\s*(§\s*\d+[a-z]?|(?:Čl\.|Článek)\s*\d+[a-z]?|[A-Z]?\.?\d+(?:\.\d+){0,4})\b\s*(.*)$/;
  const used = new Map<string, number>();
  let title = "";
  const flush = () => {
    cur.text = cur.text.trim() || title;
    if (cur.text || cur.key !== "uvod") out.push(cur);
  };
  for (const line of lines) {
    const m = line.match(head);
    if (m && line.trim().length < 200) {
      flush();
      let key = fragmentKey(null, m[1]!) ?? `k_${out.length}`;
      const n = (used.get(key) ?? 0) + 1;
      used.set(key, n);
      if (n > 1) key = `${key}~${n}`;
      cur = { key, label: `${m[1]!.trim()}${m[2] ? ` ${m[2].trim()}` : ""}`.slice(0, 300), text: "", depth: (m[1]!.match(/\./g) ?? []).length + 1, kind: "manual" };
      // název za číslem jde jen do popisku (v textu by se opakoval); bez dalšího textu zůstane jako obsah
      title = m[2]?.trim() ?? "";
    } else cur.text += `${line}\n`;
  }
  flush();
  return out;
}

/* ---------- vstupy ---------- */

export const LegalWatchInput = z.object({
  /** „264/2025 Sb.“ nebo stálá URL / ELI z e-Sbírky; u předpisů EU číslo CELEX, odkaz EUR-Lex nebo ELI. */
  reference: z.string().trim().min(3).max(500),
  /** Zdroj: e-Sbírka (výchozí) nebo EUR-Lex. */
  source: z.enum(["esbirka", "eurlex"]).optional(),
  /** Jazyk znění předpisu EU. */
  lang: z.enum(EU_LANGS).optional(),
  ownerPositionId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type LegalWatchInput = z.input<typeof LegalWatchInput>;
export const LegalWatchPatch = z.object({ ownerPositionId: z.string().uuid().nullable().optional(), notes: z.string().trim().max(2000).nullable().optional() });

/** Ručně vedený předpis / norma (např. licencovaný text ISO normy – zůstává jen ve společnosti). */
export const LegalManualActInput = z.object({
  code: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(300),
  frameworkId: z.string().trim().max(20).nullable().optional(),
  ownerPositionId: z.string().uuid().nullable().optional(),
});
export type LegalManualActInput = z.input<typeof LegalManualActInput>;
export const LegalManualVersionInput = z.object({
  label: z.string().trim().min(1).max(100),
  effectiveFrom: z.string().date().nullable().optional(),
  text: z.string().min(1).max(3_000_000),
});
export type LegalManualVersionInput = z.input<typeof LegalManualVersionInput>;

export const LegalReviewPatch = z.object({
  status: z.enum(LEGAL_REVIEW_STATUSES).optional(),
  impact: z.enum(LEGAL_IMPACTS).nullable().optional(),
  assessment: z.string().trim().max(10_000).nullable().optional(),
  ownerPositionId: z.string().uuid().nullable().optional(),
  dueDate: z.string().date().nullable().optional(),
});
export type LegalReviewPatch = z.input<typeof LegalReviewPatch>;

export const LegalTaskInput = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(5000).nullable().optional(),
  ownerPositionId: z.string().uuid().nullable().optional(),
  dueDate: z.string().date().nullable().optional(),
  status: z.enum(LEGAL_TASK_STATUSES).default("open"),
  policyId: z.string().uuid().nullable().optional(),
  controlId: z.string().uuid().nullable().optional(),
  requirementId: z.string().trim().max(100).nullable().optional(),
});
export type LegalTaskInput = z.input<typeof LegalTaskInput>;
export const LegalTaskPatch = patchOf(LegalTaskInput);

/* ---------- DTO ---------- */

export interface LegalActDto {
  id: string;
  source: LegalSource;
  /** Soukromý (ručně vedený) předpis společnosti; null = veřejný předpis z e-Sbírky. */
  companyId: string | null;
  code: string;
  title: string;
  staleUrl: string | null;
  frameworkId: string | null;
  /** textSource: odkud je text znění – opendata / web (záloha z webu e-Sbírky) / api / eurlex / null (ručně) (v1.13.2). */
  currentVersion: { id: string; label: string; effectiveFrom: string | null; fetchedAt: string; textSource: string | null } | null;
  lastCheckedAt: string | null;
  lastStatus: "ok" | "error" | null;
  lastError: string | null;
  /** Nastavené datum zrušení předpisu (RSS e-Sbírky). */
  repeal: { date: string | null; title: string } | null;
  /** Sledování v aktuální společnosti. */
  watch: { companyId: string; ownerPositionId: string | null; ownerPositionName: string | null; notes: string | null } | null;
  openReviews: number;
}

export interface LegalVersionDto {
  id: string;
  label: string;
  effectiveFrom: string | null;
  sourceUrl: string | null;
  fetchedAt: string;
  fragments: number;
  contentHash: string;
}

export interface LegalActDetail extends LegalActDto {
  versions: LegalVersionDto[];
  changes: { id: string; detectedAt: string; from: string | null; to: string; added: number; removed: number; modified: number; reviewId: string | null }[];
}

export interface LegalAffected {
  requirements: { id: string; ref: string; text: string; framework: string; fragmentKeys: string[] }[];
  controls: { id: string; code: string | null; name: string }[];
  policies: { id: string; code: string | null; title: string; via: string }[];
}

export interface LegalTaskDto {
  id: string;
  reviewId: string | null;
  companyId: string;
  title: string;
  description: string | null;
  ownerPositionId: string | null;
  ownerPositionName: string | null;
  dueDate: string | null;
  status: LegalTaskStatus;
  policy: { id: string; code: string | null; title: string } | null;
  control: { id: string; code: string | null; name: string } | null;
  requirementId: string | null;
  createdAt: string;
  doneAt: string | null;
  act: { id: string; code: string } | null;
}

export interface LegalReviewDto {
  id: string;
  companyId: string;
  status: LegalReviewStatus;
  impact: LegalImpact | null;
  assessment: string | null;
  aiSummary: string | null;
  ownerPositionId: string | null;
  ownerPositionName: string | null;
  dueDate: string | null;
  assessedByName: string | null;
  assessedAt: string | null;
  createdAt: string;
  act: { id: string; code: string; title: string };
  change: { id: string; detectedAt: string; from: string | null; to: string; effectiveFrom: string | null; added: number; removed: number; modified: number };
}

export interface LegalReviewDetail extends LegalReviewDto {
  diff: LegalDiffItem[];
  /** Rozdíl je delší, než se vrací (počet všech položek). */
  diffTotal: number;
  affected: LegalAffected;
  tasks: LegalTaskDto[];
  canEdit: boolean;
}

/** Termín posouzení změny: zjištění + dny (výchozí 14). */
export function legalReviewDue(detectedAt: string, days = 14): string {
  const d = new Date(detectedAt);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
