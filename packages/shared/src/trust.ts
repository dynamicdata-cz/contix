import { z } from "zod";

/* ============================================================
 * Bezpečnostní dotazníky zákazníků a Trust Center (v1.04, ADR-099).
 * Dotazník od zákazníka (XLSX / CSV) → otázky → odpovědi z knihovny schválených odpovědí, platné dokumentace a opatření
 * (lokální AI navrhne, člověk schválí) → export. Trust Center = veřejná stránka důvěry: certifikace, přehled opatření,
 * průběžné monitorování, subdodavatelé, dokumenty veřejně nebo po přijetí NDA a schválení žádosti.
 * ============================================================ */

export const QA_ANSWERS = ["yes", "no", "partial", "na"] as const;
export type QaAnswer = (typeof QA_ANSWERS)[number];
export const QA_ITEM_STATUSES = ["empty", "draft", "approved"] as const;
export type QaItemStatus = (typeof QA_ITEM_STATUSES)[number];
export const CUSTOMER_Q_STATUSES = ["in_progress", "approved", "sent"] as const;
export type CustomerQStatus = (typeof CUSTOMER_Q_STATUSES)[number];
export const QA_SOURCE_KINDS = ["library", "policy", "control", "certification"] as const;
export type QaSourceKind = (typeof QA_SOURCE_KINDS)[number];
export interface QaSource {
  kind: QaSourceKind;
  id: string;
  label: string;
}

/** Volby importu dotazníku (multipart vedle souboru). */
export const CustomerQImportOptions = z.object({
  customer: z.string().trim().min(1).max(200),
  title: z.string().trim().max(300).optional(),
  dueDate: z.string().date().optional(),
  sheet: z.string().max(100).optional(),
  /** Index sloupce s otázkou / odpovědí / komentářem (0 = první); bez zadání se odhadne podle záhlaví. */
  questionColumn: z.coerce.number().int().min(0).max(200).optional(),
  answerColumn: z.coerce.number().int().min(0).max(200).optional(),
  idColumn: z.coerce.number().int().min(0).max(200).optional(),
  mode: z.enum(["preview", "commit"]).default("preview"),
});

export interface CustomerQPreviewDto {
  sheets: string[];
  sheet: string | null;
  headers: string[];
  questionColumn: number | null;
  answerColumn: number | null;
  idColumn: number | null;
  questions: number;
  sample: { ref: string | null; section: string | null; question: string }[];
}

export const QaItemPatch = z.object({
  answer: z.enum(QA_ANSWERS).nullable().optional(),
  answerText: z.string().trim().max(5000).nullable().optional(),
  status: z.enum(QA_ITEM_STATUSES).optional(),
});
export type QaItemPatch = z.input<typeof QaItemPatch>;

export const QaBulkApprove = z.object({ ids: z.array(z.string().uuid()).min(1).max(2000) });

export interface QaItemDto {
  id: string;
  seq: number;
  sourceRow: number | null;
  ref: string | null;
  section: string | null;
  question: string;
  answer: QaAnswer | null;
  answerText: string | null;
  sources: QaSource[];
  status: QaItemStatus;
  confidence: "low" | "medium" | "high" | null;
  answeredBy: "ai" | "user" | "library" | null;
  approvedByName: string | null;
  /** Nejlepší shoda v knihovně (podobnost 0–1) – pro rychlé převzetí. */
  libraryMatch: { id: string; score: number; question: string; answer: QaAnswer | null; answerText: string | null } | null;
}

export interface CustomerQDto {
  id: string;
  companyId: string;
  customer: string;
  title: string;
  dueDate: string | null;
  status: CustomerQStatus;
  fileName: string | null;
  counts: Record<QaItemStatus, number>;
  createdAt: string;
  approvedAt: string | null;
  approvedByName: string | null;
}

export interface CustomerQDetailDto extends CustomerQDto {
  items: QaItemDto[];
}

export const AnswerLibraryInput = z.object({
  question: z.string().trim().min(5).max(2000),
  answer: z.enum(QA_ANSWERS).nullable().optional(),
  answerText: z.string().trim().max(5000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
});
export type AnswerLibraryInput = z.input<typeof AnswerLibraryInput>;

export interface AnswerLibraryDto {
  id: string;
  question: string;
  answer: QaAnswer | null;
  answerText: string | null;
  tags: string[];
  sources: QaSource[];
  usage: number;
  updatedAt: string;
}

/* ---------- podobnost otázek (bez modelu, deterministicky) ---------- */

const STOP = new Set(
  "a an and are as at be by do does for from has have how in is it of on or that the this to was what when where which who will with you your we our there any all have do je jsou a i v ve na se k ke z ze do pro o od po při jak jaký jaká jaké který která které máte má mají zda či nebo také tak to ten ta tu této tohoto vaše váš vaši vás".split(" "),
);
/** Normalizace pro porovnání: malá písmena, bez diakritiky a interpunkce, bez krátkých a častých slov. */
export function qaTokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => (w.length > 6 ? w.slice(0, 6) : w)); // hrubé „kmenování“ – shoda začátku slova
}

/** Podobnost dvou otázek 0–1 (Dice nad množinami slov). */
export function qaSimilarity(a: string, b: string): number {
  const x = new Set(qaTokens(a));
  const y = new Set(qaTokens(b));
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return (2 * both) / (x.size + y.size);
}

/** Nejlepší shody v knihovně (seřazené, nad prahem). */
export function bestMatches<T extends { question: string }>(question: string, library: T[], n = 3, min = 0.35): (T & { score: number })[] {
  return library
    .map((l) => ({ ...l, score: Math.round(qaSimilarity(question, l.question) * 100) / 100 }))
    .filter((l) => l.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

/** Odhad sloupců dotazníku podle záhlaví (otázka / odpověď / ID). */
export function guessQuestionColumns(headers: string[]): { question: number | null; answer: number | null; id: number | null } {
  const h = headers.map((x) => x.toLowerCase());
  const find = (re: RegExp) => {
    const i = h.findIndex((x) => re.test(x));
    return i >= 0 ? i : null;
  };
  return {
    question: find(/question|ot[aá]zk|dotaz|po[zž]adav|requirement|control (description|question)|^control$/),
    answer: find(/answer|odpov|response|vyj[aá]d|yes\/no|ano\/ne|status|compliance/),
    id: find(/^(id|#|no\.?|č\.?|ref|reference|control id|ID ot)/i),
  };
}

/* ---------- Trust Center ---------- */

export const TRUST_DOC_ACCESS = ["public", "nda"] as const;
export type TrustDocAccess = (typeof TRUST_DOC_ACCESS)[number];

export const TrustCertification = z.object({
  name: z.string().trim().min(1).max(120),
  issuer: z.string().trim().max(200).optional().nullable(),
  validUntil: z.string().date().optional().nullable(),
  scope: z.string().trim().max(500).optional().nullable(),
});
export type TrustCertification = z.infer<typeof TrustCertification>;

export const TrustSettingsInput = z.object({
  enabled: z.boolean().default(false),
  /** Adresa stránky /t/<slug> – malá písmena, číslice, pomlčky. */
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/, "Adresa: 3–50 znaků, malá písmena, číslice a pomlčky"),
  title: z.string().trim().min(1).max(200),
  intro: z.string().trim().max(5000).optional().nullable(),
  contactEmail: z.string().trim().email().max(200).optional().nullable(),
  certifications: z.array(TrustCertification).max(20).default([]),
  documents: z.array(z.object({ policyId: z.string().uuid(), access: z.enum(TRUST_DOC_ACCESS) })).max(50).default([]),
  subprocessorIds: z.array(z.string().uuid()).max(100).default([]),
  showControls: z.boolean().default(true),
  showMonitoring: z.boolean().default(true),
  ndaText: z.string().trim().max(10_000).optional().nullable(),
  /** Platnost přístupu po schválení žádosti (dny). */
  accessDays: z.number().int().min(1).max(365).default(30),
});
export type TrustSettingsInput = z.input<typeof TrustSettingsInput>;
export type TrustSettings = z.infer<typeof TrustSettingsInput>;

export const TrustAccessRequestInput = z.object({
  name: z.string().trim().min(2).max(200),
  email: z.string().trim().email().max(200),
  organization: z.string().trim().min(2).max(200),
  reason: z.string().trim().max(2000).optional().nullable(),
  ndaAccepted: z.literal(true, { message: "Je potřeba přijmout podmínky mlčenlivosti" }),
  /** Past na roboty – skryté pole musí zůstat prázdné. */
  website: z.string().max(0).optional(),
});
export type TrustAccessRequestInput = z.input<typeof TrustAccessRequestInput>;

export const TRUST_REQUEST_STATUSES = ["pending", "approved", "rejected", "revoked"] as const;
export type TrustRequestStatus = (typeof TRUST_REQUEST_STATUSES)[number];

export interface TrustAccessRequestDto {
  id: string;
  name: string;
  email: string;
  organization: string;
  reason: string | null;
  status: TrustRequestStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedByName: string | null;
  expiresAt: string | null;
  downloads: number;
}

export interface TrustSettingsDto extends TrustSettings {
  companyId: string;
  url: string | null;
  pendingRequests: number;
}

/** Veřejný profil Trust Center (bez interních údajů, jmen osob a podrobností běhů). */
export interface PublicTrustDto {
  slug: string;
  title: string;
  organization: string;
  intro: string | null;
  contactEmail: string | null;
  updatedAt: string;
  certifications: (TrustCertification & { valid: boolean })[];
  controls: { category: string; implemented: number; total: number }[] | null;
  monitoring: { label: string; passRate90: number | null; lastResult: string | null }[] | null;
  subprocessors: { name: string; country: string | null; purpose: string | null }[];
  documents: { id: string; title: string; version: string | null; effectiveFrom: string | null; access: TrustDocAccess; available: boolean }[];
  ndaText: string | null;
  /** Platný přístup podle tokenu z odkazu (jinak null). */
  access: { name: string; organization: string; expiresAt: string } | null;
}

export const TRUST_LABELS = {
  answer: { yes: "Ano", no: "Ne", partial: "Částečně", na: "Netýká se" } satisfies Record<QaAnswer, string>,
  itemStatus: { empty: "Bez odpovědi", draft: "Návrh", approved: "Schváleno" } satisfies Record<QaItemStatus, string>,
  qStatus: { in_progress: "Rozpracováno", approved: "Schváleno", sent: "Odesláno" } satisfies Record<CustomerQStatus, string>,
  source: { library: "Knihovna odpovědí", policy: "Dokument", control: "Opatření", certification: "Certifikace" } satisfies Record<QaSourceKind, string>,
  access: { public: "Veřejně", nda: "Po schválení (NDA)" } satisfies Record<TrustDocAccess, string>,
  requestStatus: { pending: "Čeká na schválení", approved: "Schváleno", rejected: "Zamítnuto", revoked: "Odebráno" } satisfies Record<TrustRequestStatus, string>,
} as const;

/** Texty veřejné stránky Trust Center (mimo přihlášení a jazykový balíček uživatele). */
export const TRUST_PUBLIC_TEXT = {
  cs: {
    notFound: "Stránka nenalezena.",
    certifications: "Certifikace a zprávy",
    validUntil: "Platnost do",
    expired: "vypršela",
    monitoring: "Průběžné monitorování bezpečnostních opatření",
    last90: "úspěšnost za 90 dní",
    controls: "Bezpečnostní opatření",
    implemented: "zavedených opatření",
    documents: "Dokumenty",
    version: "Verze",
    effective: "účinnost od",
    download: "Stáhnout PDF",
    unavailable: "PDF není k dispozici",
    ndaOnly: "Po schválení žádosti",
    requestAccess: "Požádat o přístup k dokumentům",
    subprocessors: "Subdodavatelé",
    contact: "Kontakt:",
    updated: "Aktualizováno",
    accessFor: "Přístup k důvěrným dokumentům pro {name} ({org}) platí do {date}. Dokumenty jsou poskytnuty na základě NDA.",
    name: "Jméno a příjmení",
    email: "Pracovní e-mail",
    organization: "Organizace",
    reason: "Účel (nepovinné)",
    ndaAccept: "Souhlasím s podmínkami mlčenlivosti (NDA) a použiji dokumenty jen k posouzení spolupráce.",
    send: "Odeslat žádost",
    cancel: "Zrušit",
    requestSent: "Žádost byla odeslána. Po schválení vám přijde odkaz e-mailem.",
  },
  en: {
    notFound: "Page not found.",
    certifications: "Certifications and reports",
    validUntil: "Valid until",
    expired: "expired",
    monitoring: "Continuous monitoring of security controls",
    last90: "pass rate in 90 days",
    controls: "Security controls",
    implemented: "controls implemented",
    documents: "Documents",
    version: "Version",
    effective: "effective from",
    download: "Download PDF",
    unavailable: "PDF not available",
    ndaOnly: "After approval",
    requestAccess: "Request access to documents",
    subprocessors: "Subprocessors",
    contact: "Contact:",
    updated: "Updated",
    accessFor: "Access to confidential documents for {name} ({org}) is valid until {date}. Documents are provided under an NDA.",
    name: "Full name",
    email: "Work e-mail",
    organization: "Organization",
    reason: "Purpose (optional)",
    ndaAccept: "I agree to the non-disclosure terms (NDA) and will use the documents only to evaluate the cooperation.",
    send: "Send request",
    cancel: "Cancel",
    requestSent: "The request has been sent. After approval you will receive a link by e-mail.",
  },
} as const;
