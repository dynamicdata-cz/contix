import { z } from "zod";
import { patchOf } from "./zutil";

/* ============================================================
 * Bezpečnostní politika a bezpečnostní dokumentace – § 6 vyhl. č. 409/2025 Sb.
 * (vyhl. 410: § 3 odst. 3)
 *  - odst. 1: politika a dokumentace k opatřením § 3–27,
 *  - odst. 3–4: pravidelný přezkum, aktuálnost, odpovědná osoba,
 *  - odst. 5: dostupnost, informování dotčených osob, ochrana CIA, identifikovatelnost a vyhledatelnost.
 * ============================================================ */

export const POLICY_TYPES = ["policy", "directive", "methodology", "decision", "procedure", "standard", "plan", "guideline", "form", "record"] as const;
export type PolicyType = (typeof POLICY_TYPES)[number];
export const POLICY_STATUSES = ["draft", "active", "retired"] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];
/** Workflow verze: návrh (gestor) → věcná kontrola (vlastník procesu) → schválení (schvalovatel) → platná → nahrazená. */
export const POLICY_VERSION_STATUSES = ["draft", "review", "approval", "approved", "superseded"] as const;
export type PolicyVersionStatus = (typeof POLICY_VERSION_STATUSES)[number];
export const POLICY_WORKFLOW_ACTIONS = ["submit", "review_ok", "return", "approve", "direct_approve"] as const;
/** Záznamy historie verze – kroky oběhu + práce se soubory (rezervace, nová revize, šablona). */
export const POLICY_EVENT_ACTIONS = [...POLICY_WORKFLOW_ACTIONS, "checkout", "checkin", "unlock", "template", "office_save"] as const;
export type PolicyEventAction = (typeof POLICY_EVENT_ACTIONS)[number];
/** Skartační znak (vyhl. č. 259/2012 Sb.): A = archiválie, S = skartovat, V = výběr archivem. */
export const RETENTION_MARKS = ["A", "S", "V"] as const;
export type RetentionMark = (typeof RETENTION_MARKS)[number];
export const DISPOSAL_MODES = ["shredded", "archived"] as const;
export type DisposalMode = (typeof DISPOSAL_MODES)[number];
export type PolicyWorkflowAction = (typeof POLICY_WORKFLOW_ACTIONS)[number];
export const POLICY_COMMENT_STATUSES = ["open", "accepted", "rejected"] as const;
export type PolicyCommentStatus = (typeof POLICY_COMMENT_STATUSES)[number];
export const CLASSIFICATIONS = ["public", "internal", "confidential", "restricted"] as const;
/** Systém řízení / oblast, do které dokument patří (v0.33). Kontroly § 6 a pokrytí vyhlášky platí jen pro ISMS. */
export const MANAGEMENT_SYSTEMS = ["isms", "qms", "ems", "ohs", "privacy", "bcm", "general"] as const;
export type ManagementSystem = (typeof MANAGEMENT_SYSTEMS)[number];
/** Výchozí rámec pro pokrytí požadavků podle systému řízení (ISMS = podle režimu ZKB). */
export const SYSTEM_FRAMEWORK: Partial<Record<ManagementSystem, "iso9001" | "iso27001">> = { qms: "iso9001" };
export type Classification = (typeof CLASSIFICATIONS)[number];

export const POLICY_LABELS = {
  type: {
    policy: "Politika",
    directive: "Směrnice",
    procedure: "Postup / provozní dokumentace",
    standard: "Standard / technická konfigurace",
    plan: "Plán",
    methodology: "Metodika",
    decision: "Rozhodnutí",
    guideline: "Pokyn / příručka",
    form: "Formulář / šablona",
    record: "Záznam / evidence",
  } satisfies Record<PolicyType, string>,
  system: {
    isms: "Bezpečnost informací / kybernetická bezpečnost",
    qms: "Kvalita (ISO 9001)",
    ems: "Životní prostředí (ISO 14001)",
    ohs: "BOZP (ISO 45001)",
    privacy: "Ochrana osobních údajů (GDPR)",
    bcm: "Kontinuita činností (ISO 22301)",
    general: "Obecné vnitřní předpisy",
  } satisfies Record<ManagementSystem, string>,
  status: { draft: "V přípravě", active: "Platný", retired: "Zrušený" } satisfies Record<PolicyStatus, string>,
  versionStatus: { draft: "Návrh", review: "Věcná kontrola", approval: "Ke schválení", approved: "Platná", superseded: "Nahrazená" } satisfies Record<PolicyVersionStatus, string>,
  role: { owner: "Gestor", reviewer: "Vlastník procesu", approver: "Schvalovatel" },
  workflowAction: {
    submit: "Předloženo ke kontrole",
    review_ok: "Věcně zkontrolováno",
    return: "Vráceno k přepracování",
    approve: "Schváleno",
    direct_approve: "Schváleno přímo (správce)",
    checkout: "Rezervováno k úpravě",
    checkin: "Vráceno po úpravě (nová revize)",
    unlock: "Rezervace zrušena",
    template: "Soubor vytvořen ze šablony",
    office_save: "Uloženo z Office (nová revize)",
  } satisfies Record<PolicyEventAction, string>,
  retentionMark: { A: "A – archiválie", S: "S – skartovat", V: "V – výběr archivem" } satisfies Record<RetentionMark, string>,
  disposalMode: { shredded: "Skartováno", archived: "Předáno do archivu" } satisfies Record<DisposalMode, string>,
  commentStatus: { open: "Otevřená", accepted: "Přijata", rejected: "Nepřijata" } satisfies Record<PolicyCommentStatus, string>,
  classification: { public: "Veřejné", internal: "Interní", confidential: "Důvěrné", restricted: "Přísně důvěrné" } satisfies Record<Classification, string>,
};

/** Okruh dotčených osob – sdíleno s plánem povědomí (§ 10). */
export const Audience = z.object({
  /** Všichni uživatelé společnosti. */
  all: z.boolean().default(false),
  unitIds: z.array(z.string().uuid()).max(200).default([]),
  positionIds: z.array(z.string().uuid()).max(500).default([]),
  /** Bezpečnostní role funkčních míst (např. „Manažer kybernetické bezpečnosti“). */
  securityRoles: z.array(z.string().trim().max(100)).max(20).default([]),
  /** Vrcholné vedení = vedoucí funkční místa nejvyšších útvarů. */
  management: z.boolean().default(false),
});
export type Audience = z.infer<typeof Audience>;
export const EMPTY_AUDIENCE: Audience = { all: false, unitIds: [], positionIds: [], securityRoles: [], management: false };

const text = (max = 5000) => z.string().trim().max(max).nullable().optional();

export const PolicyInput = z.object({
  companyId: z.string().uuid().optional(),
  /** Prázdné = přidělí se automaticky (prefix složky nebo druhu dokumentu + pořadové číslo). */
  code: z.string().trim().max(50).nullable().optional(),
  folderId: z.string().uuid().nullable().optional(),
  /** Skartační lhůta v letech (prázdné = výchozí dle druhu dokumentu). */
  retentionYears: z.number().int().min(1).max(100).nullable().optional(),
  retentionMark: z.enum(RETENTION_MARKS).nullable().optional(),
  title: z.string().trim().min(1).max(300),
  docType: z.enum(POLICY_TYPES).default("directive"),
  /** Systém řízení / oblast (ISMS, kvalita, BOZP, obecné předpisy…). */
  system: z.enum(MANAGEMENT_SYSTEMS).default("isms"),
  status: z.enum(POLICY_STATUSES).default("draft"),
  description: text(),
  /** Oddíly vyhlášky, ke kterým dokument patří (§ 6 odst. 1 – dokumentace k opatřením § 3–27). */
  sections: z.array(z.string().trim().min(1).max(20)).max(40).default([]),
  /** Gestor – § 6 odst. 4 osoba odpovědná za obsah, přezkum a aktualizaci; připravuje verze. */
  ownerPositionId: z.string().uuid().nullable().optional(),
  /** Vlastník procesu – věcná kontrola verze (prázdné = krok se přeskočí). */
  reviewerPositionId: z.string().uuid().nullable().optional(),
  /** Schvalovatel – schvaluje verzi (prázdné = oprávnění „Schvalovat dokumenty ISMS“). */
  approverPositionId: z.string().uuid().nullable().optional(),
  /** Lhůta pro seznámení dotčených osob s novou verzí (dny). */
  ackDueDays: z.number().int().min(1).max(180).default(14),
  /** Nová verze vyžaduje opakování navázaných školení. */
  retrainOnNewVersion: z.boolean().default(false),
  /** Hranice úspěšnosti testu porozumění (%). */
  quizPassPct: z.number().int().min(1).max(100).default(80),
  /** § 6 odst. 3 – interval přezkumu. */
  reviewMonths: z.number().int().min(1).max(60).default(12),
  /** § 6 odst. 5 písm. d) – klasifikace. */
  classification: z.enum(CLASSIFICATIONS).default("internal"),
  /** § 6 odst. 5 písm. a, c) – kde je dokument dostupný (odkaz na DMS, SharePoint, listinná podoba…). */
  location: text(1000),
  audience: Audience.default(EMPTY_AUDIENCE),
  /** Vyžadovat prokazatelné seznámení dotčených osob (§ 6 odst. 5 písm. b). */
  requireAcknowledgement: z.boolean().default(true),
  controlIds: z.array(z.string().uuid()).max(200).default([]),
  /* ---------- vazby dokumentu (v0.31) ---------- */
  /** Nadřazený dokument (hierarchie politika → směrnice → postup / standard). */
  parentId: z.string().uuid().nullable().optional(),
  /** Související dokumenty – vazba je obousměrná. */
  relatedIds: z.array(z.string().uuid()).max(200).default([]),
  /** Požadavky předpisů z katalogu (stabilní ID, např. „cz409:§19/1“). */
  requirementIds: z.array(z.string().trim().min(1).max(100)).max(300).default([]),
  processIds: z.array(z.string().uuid()).max(200).default([]),
  assetIds: z.array(z.string().uuid()).max(500).default([]),
  riskIds: z.array(z.string().uuid()).max(300).default([]),
  supplierIds: z.array(z.string().uuid()).max(200).default([]),
});
export type PolicyInput = z.input<typeof PolicyInput>;

/** Pole vazeb v PolicyInput (ukládají se do vazebních tabulek, ne do `policies`). */
export const POLICY_LINK_KEYS = ["controlIds", "relatedIds", "requirementIds", "processIds", "assetIds", "riskIds", "supplierIds"] as const;
export type PolicyLinkKey = (typeof POLICY_LINK_KEYS)[number];

/** Druh záznamu, na kterém se zobrazují navázané dokumenty. */
export const POLICY_LINK_KINDS = ["process", "asset", "risk", "supplier", "control", "requirement"] as const;
export type PolicyLinkKind = (typeof POLICY_LINK_KINDS)[number];

/** Odkaz na dokument (vazby, hierarchie). */
export interface PolicyRef {
  id: string;
  code: string | null;
  title: string;
  docType: PolicyType;
  status: PolicyStatus;
  currentVersion?: string | null;
}

/** Nadřazený dokument nesmí vytvořit cyklus (dokument nemůže být pod sebou ani pod svým potomkem). */
export function parentCycle(list: { id: string; parentId: string | null }[], id: string, parentId: string | null): boolean {
  const parent = new Map(list.map((x) => [x.id, x.parentId]));
  let cur = parentId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === id || seen.has(cur)) return true;
    seen.add(cur);
    cur = parent.get(cur) ?? null;
  }
  return false;
}
export const PolicyPatch = patchOf(PolicyInput.omit({ companyId: true }));

export const PolicyVersionInput = z.object({
  version: z.string().trim().min(1).max(20),
  changeSummary: text(),
  /** Text dokumentu (Markdown) – volitelné, jinak odkaz na umístění. */
  content: z.string().max(500_000).nullable().optional(),
  effectiveFrom: z.string().date().nullable().optional(),
});
export type PolicyVersionInput = z.input<typeof PolicyVersionInput>;

export const PolicyReviewInput = z.object({
  /** Přezkoumáno beze změny (bez nové verze). */
  note: z.string().trim().max(2000).nullable().optional(),
  reviewedAt: z.string().date().optional(),
});

export const PolicyWorkflowInput = z.object({
  action: z.enum(["submit", "review_ok", "return", "approve"]),
  note: z.string().trim().max(2000).nullable().optional(),
});
export type PolicyWorkflowInput = z.input<typeof PolicyWorkflowInput>;

export const PolicyCommentInput = z.object({
  text: z.string().trim().min(3, "Napište připomínku").max(4000),
  /** Odstavec / článek, ke kterému se připomínka vztahuje. */
  reference: z.string().trim().max(200).nullable().optional(),
});
export type PolicyCommentInput = z.input<typeof PolicyCommentInput>;
export const PolicyCommentResolveInput = z.object({
  status: z.enum(["accepted", "rejected"]),
  response: z.string().trim().min(1, "Napište vyjádření").max(4000),
});

export const QuizQuestionInput = z.object({
  question: z.string().trim().min(3).max(1000),
  options: z.array(z.string().trim().min(1).max(500)).min(2).max(8),
  /** Indexy správných odpovědí (alespoň jedna). */
  correct: z.array(z.number().int().min(0).max(7)).min(1).max(8),
});
export const QuizInput = z
  .array(QuizQuestionInput)
  .max(30)
  .refine((qs) => qs.every((q) => q.correct.every((i) => i < q.options.length)), "Správná odpověď musí být jednou z možností");
export type QuizInput = z.input<typeof QuizInput>;
export const QuizAnswersInput = z.object({ answers: z.array(z.array(z.number().int().min(0).max(7)).max(8)).max(30) });

export interface PolicyFileDto {
  id: string;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  uploadedAt: string;
  uploadedByName: string | null;
  /** Revize souboru v rámci verze (1 = první nahrání). */
  revision: number;
  /** Poznámka k revizi (check-in). */
  note: string | null;
  /** Soubor, který tato revize nahradila. */
  replacesId: string | null;
  /** PDF pro čtení (s doložkou) – stav převodu. */
  pdf: PdfStatus;
  pdfError: string | null;
  /** Text souboru je k dispozici (vyhledávání, porovnání). */
  hasText: boolean;
}

export interface PolicyEventDto {
  action: PolicyEventAction;
  fromStatus: PolicyVersionStatus;
  toStatus: PolicyVersionStatus;
  note: string | null;
  userName: string | null;
  at: string;
}

export interface PolicyVersionDto {
  id: string;
  version: string;
  status: PolicyVersionStatus;
  changeSummary: string | null;
  hasContent: boolean;
  effectiveFrom: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  submittedAt: string | null;
  createdAt: string;
  acknowledged: number;
  files: PolicyFileDto[];
  /** Starší revize souborů (nahrazené při check-inu). */
  fileHistory: PolicyFileDto[];
  events: PolicyEventDto[];
  /** Rezervace k úpravě (check-out). */
  lock: { userName: string | null; at: string; mine: boolean } | null;
  /** Úprava v desktopovém Office (jen pro držitele rezervace). */
  office: { open: boolean; saves: number; lastSavedAt: string | null; filename: string } | null;
  /** Co smí přihlášený uživatel s verzí udělat. */
  can: { edit: boolean; submit: boolean; review: boolean; approve: boolean; directApprove: boolean; checkout: boolean; checkin: boolean; unlock: boolean };
}

export interface PolicyCommentDto {
  id: string;
  policyId: string;
  version: string | null;
  reference: string | null;
  text: string;
  status: PolicyCommentStatus;
  response: string | null;
  authorName: string | null;
  respondedByName: string | null;
  createdAt: string;
  respondedAt: string | null;
  mine: boolean;
}

export interface QuizQuestionDto {
  question: string;
  options: string[];
  /** Jen pro správce dokumentace. */
  correct?: number[];
  multiple: boolean;
}

export interface PolicyListItem {
  id: string;
  companyId: string;
  code: string | null;
  title: string;
  folderId: string | null;
  /** Cesta ke složce („Směrnice ISMS / Provoz“). */
  folderPath: string | null;
  /** Nadřazený dokument. */
  parentId: string | null;
  docType: PolicyType;
  system: ManagementSystem;
  status: PolicyStatus;
  sections: string[];
  classification: Classification;
  ownerPositionId: string | null;
  ownerPositionName: string | null;
  reviewerPositionName: string | null;
  approverPositionName: string | null;
  currentVersion: string | null;
  /** Verze v oběhu (ke kontrole / schválení). */
  pendingVersion: { version: string; status: PolicyVersionStatus } | null;
  openComments: number;
  approvedAt: string | null;
  lastReviewedAt: string | null;
  nextReviewDue: string | null;
  reviewOverdue: boolean;
  /** Seznámení s platnou verzí: potvrzeno / dotčených osob. */
  ack: { done: number; required: number };
  gaps: string[];
  /** Skartační lhůta – běží od zrušení dokumentu. */
  retention: RetentionInfo;
  /** Verze rezervovaná k úpravě. */
  locked: { version: string; userName: string | null; at: string } | null;
  updatedAt: string;
}

export interface PolicyDetail extends PolicyListItem {
  description: string | null;
  reviewMonths: number;
  location: string | null;
  audience: Audience;
  requireAcknowledgement: boolean;
  reviewerPositionId: string | null;
  approverPositionId: string | null;
  ackDueDays: number;
  retrainOnNewVersion: boolean;
  quizPassPct: number;
  quiz: QuizQuestionDto[];
  comments: PolicyCommentDto[];
  courses: { id: string; code: string | null; title: string; form: string }[];
  lastReviewNote: string | null;
  controls: { id: string; code: string | null; name: string }[];
  /** Vazby dokumentu (v0.31). */
  parent: PolicyRef | null;
  children: PolicyRef[];
  related: PolicyRef[];
  requirements: { id: string; framework: string; ref: string; text: string }[];
  processes: { id: string; code: string | null; name: string }[];
  assets: { id: string; name: string; assetType: string }[];
  risks: { id: string; code: string | null; name: string }[];
  suppliers: { id: string; name: string }[];
  versions: PolicyVersionDto[];
  /** Dotčené osoby a stav seznámení s platnou verzí. */
  people: { userId: string; name: string; acknowledgedAt: string | null }[];
  /** Vlastní hodnoty (null = výchozí dle druhu). */
  retentionYears: number | null;
  retentionMark: RetentionMark | null;
  disposal: { at: string; byName: string | null; mode: DisposalMode; note: string | null; reference: string | null } | null;
  canEdit: boolean;
}

/** Dokument v portálu pro zaměstnance (jen platné verze). */
export interface PortalDocItem {
  id: string;
  companyId: string;
  code: string | null;
  title: string;
  docType: PolicyType;
  classification: Classification;
  folderId: string | null;
  folderPath: string | null;
  version: string;
  versionId: string;
  approvedAt: string | null;
  effectiveFrom: string | null;
  ownerPositionName: string | null;
  description: string | null;
  sections: string[];
  /** Uživatel je v okruhu dotčených osob → musí potvrdit seznámení. */
  mustAcknowledge: boolean;
  acknowledgedAt: string | null;
  ackDue: string | null;
  hasQuiz: boolean;
  quizPassed: boolean;
  hasContent: boolean;
  files: PolicyFileDto[];
  location: string | null;
  /** Úryvek z textu při hledání. */
  snippet: string | null;
}

export interface PortalDocDetail extends PortalDocItem {
  content: string | null;
  quizPassPct: number;
  quiz: QuizQuestionDto[];
  myComments: PolicyCommentDto[];
  history: { version: string; approvedAt: string | null; changeSummary: string | null }[];
  /** Předchozí platná verze – lze zobrazit změny. */
  previousVersion: string | null;
}

/** Položka „k seznámení“ pro přihlášeného uživatele. */
export interface MyPolicyItem {
  policyId: string;
  versionId: string;
  code: string | null;
  title: string;
  version: string;
  docType: PolicyType;
  approvedAt: string | null;
  location: string | null;
  hasContent: boolean;
  acknowledgedAt: string | null;
}

export interface PolicyCoverageRow {
  section: string;
  title: string;
  documents: number;
}

/** Termín dalšího přezkumu: poslední přezkum nebo schválení + interval. */
export function nextReview(lastReviewedAt: string | null, approvedAt: string | null, months: number): string | null {
  const base = [lastReviewedAt, approvedAt].filter(Boolean).sort().at(-1);
  if (!base) return null;
  const d = new Date(base);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Nesplněné náležitosti dokumentu dle § 6. */
export function policyGaps(p: {
  status: PolicyStatus;
  system?: ManagementSystem;
  ownerPositionId: string | null;
  currentVersion: string | null;
  reviewOverdue: boolean;
  location: string | null;
  hasContent: boolean;
  requireAcknowledgement: boolean;
  ack: { done: number; required: number };
}): string[] {
  if (p.status === "retired") return [];
  // odkazy na § 6 vyhlášky jen u bezpečnostní dokumentace (ISMS)
  const ref = (s: string) => ((p.system ?? "isms") === "isms" ? ` (${s})` : "");
  const g: string[] = [];
  if (!p.currentVersion) g.push(`Dokument nemá schválenou verzi${ref("§ 6 odst. 1")}.`);
  if (!p.ownerPositionId) g.push(`Není určena osoba odpovědná za přezkum a aktualizaci${ref("§ 6 odst. 4")}.`);
  if (p.reviewOverdue) g.push(`Uplynul termín pravidelného přezkumu${ref("§ 6 odst. 3")}.`);
  if (p.currentVersion && !p.location && !p.hasContent) g.push(`Není uvedeno, kde je dokument dostupný${ref("§ 6 odst. 5 písm. a, c")}.`);
  if (p.currentVersion && p.requireAcknowledgement && p.ack.required === 0) g.push(`Není určen okruh dotčených osob${ref("§ 6 odst. 5 písm. b")}.`);
  else if (p.currentVersion && p.requireAcknowledgement && p.ack.done < p.ack.required)
    g.push(`Seznámeno ${p.ack.done} z ${p.ack.required} dotčených osob${ref("§ 6 odst. 5 písm. b")}.`);
  return g;
}

/* ============================================================
 * DMS II (v0.23): složky a číslování, šablony, check-out / check-in, skartace
 * ============================================================ */

/** Výchozí prefix označení dle druhu dokumentu (složka může mít vlastní). */
export const DOC_CODE_PREFIX: Record<PolicyType, string> = {
  policy: "PO",
  directive: "SM",
  procedure: "PP",
  standard: "ST",
  plan: "PL",
  methodology: "MT",
  decision: "RO",
  guideline: "PK",
  form: "FO",
  record: "ZA",
};

/** Další volné označení v řadě: „SM-001“, „SM-002“… (čísla mimo řadu se ignorují). */
export function nextDocCode(prefix: string, codes: (string | null)[], width = 3): string {
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`, "i");
  let max = 0;
  for (const c of codes) {
    const m = c?.trim().match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(width, "0")}`;
}

export const PolicyFolderInput = z.object({
  companyId: z.string().uuid().optional(),
  parentId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(200),
  /** Prefix číslování dokumentů ve složce (např. „SM-ISMS“). */
  codePrefix: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]+(-[A-Z0-9]+)*$/, "Jen velká písmena, číslice a pomlčky (např. SM nebo SM-ISMS)")
    .max(15)
    .nullable()
    .optional(),
  position: z.number().int().min(0).max(1000).default(0),
});
export type PolicyFolderInput = z.input<typeof PolicyFolderInput>;
export const PolicyFolderPatch = patchOf(PolicyFolderInput.omit({ companyId: true }));

export interface PolicyFolderDto {
  id: string;
  companyId: string;
  parentId: string | null;
  name: string;
  codePrefix: string | null;
  position: number;
  /** Cesta od kořene. */
  path: string;
  depth: number;
  documents: number;
}

/** Strom složek → seřazený plochý seznam s hloubkou (pro výběr a navigaci). */
export function folderTree<T extends { id: string; parentId: string | null; name: string; position: number }>(list: T[]): (T & { depth: number; path: string })[] {
  const kids = new Map<string | null, T[]>();
  const ids = new Set(list.map((f) => f.id));
  for (const f of list) {
    const k = f.parentId && ids.has(f.parentId) ? f.parentId : null;
    kids.set(k, [...(kids.get(k) ?? []), f]);
  }
  const out: (T & { depth: number; path: string })[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number, prefix: string) => {
    for (const f of (kids.get(parent) ?? []).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "cs"))) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      const path = prefix ? `${prefix} / ${f.name}` : f.name;
      out.push({ ...f, depth, path });
      walk(f.id, depth + 1, path);
    }
  };
  walk(null, 0, "");
  return out;
}

/** Id složky a všech podsložek. */
export function folderDescendants(list: { id: string; parentId: string | null }[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of list)
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
  }
  return out;
}

export interface PolicyTemplateDto {
  id: string;
  companyId: string;
  name: string;
  docType: PolicyType | null;
  filename: string;
  size: number;
  uploadedAt: string;
  uploadedByName: string | null;
}

/** Zástupné značky šablony Wordu – nahradí se při vytvoření souboru verze. */
export const TEMPLATE_PLACEHOLDERS = {
  kod: "Označení dokumentu",
  nazev: "Název dokumentu",
  druh: "Druh dokumentu",
  verze: "Číslo verze",
  gestor: "Gestor (funkční místo)",
  vlastnik: "Vlastník procesu (funkční místo)",
  schvalovatel: "Schvalovatel (funkční místo)",
  klasifikace: "Klasifikace",
  spolecnost: "Společnost",
  datum: "Datum vytvoření souboru",
} as const;
export type TemplatePlaceholder = keyof typeof TEMPLATE_PLACEHOLDERS;

export const FromTemplateInput = z.object({ templateId: z.string().uuid() });
export const CheckinInput = z.object({ note: z.string().trim().max(1000).nullable().optional() });

/** Výchozí skartační režim dle druhu dokumentu (lze změnit u dokumentu). */
export const DEFAULT_RETENTION: Record<PolicyType, { years: number; mark: RetentionMark }> = {
  policy: { years: 10, mark: "A" },
  directive: { years: 10, mark: "A" },
  procedure: { years: 5, mark: "V" },
  standard: { years: 5, mark: "S" },
  plan: { years: 5, mark: "V" },
  methodology: { years: 10, mark: "A" },
  decision: { years: 10, mark: "A" },
  guideline: { years: 5, mark: "S" },
  form: { years: 5, mark: "S" },
  record: { years: 5, mark: "S" },
};

export type RetentionState = "active" | "running" | "due" | "disposed";
export interface RetentionInfo {
  years: number;
  mark: RetentionMark;
  state: RetentionState;
  /** Spouštěcí událost (zrušení dokumentu). */
  retiredAt: string | null;
  /** Lhůta uplyne (1. 1. roku následujícího po spouštěcí události + roky). */
  dueAt: string | null;
}

/**
 * Skartační lhůta: začíná 1. ledna roku následujícího po zrušení dokumentu (§ 15 vyhl. č. 259/2012 Sb.)
 * a uplyne po zadaném počtu let.
 */
export function retentionOf(
  p: { docType: PolicyType; status: PolicyStatus; retentionYears: number | null; retentionMark: RetentionMark | null; retiredAt: string | null; disposedAt: string | null },
  today: string,
): RetentionInfo {
  const def = DEFAULT_RETENTION[p.docType];
  const years = p.retentionYears ?? def.years;
  const mark = p.retentionMark ?? def.mark;
  if (p.disposedAt) return { years, mark, state: "disposed", retiredAt: p.retiredAt, dueAt: null };
  if (p.status !== "retired" || !p.retiredAt) return { years, mark, state: "active", retiredAt: null, dueAt: null };
  const dueAt = `${Number(p.retiredAt.slice(0, 4)) + 1 + years}-01-01`;
  return { years, mark, state: dueAt <= today ? "due" : "running", retiredAt: p.retiredAt, dueAt };
}

export const DisposeInput = z.object({
  mode: z.enum(DISPOSAL_MODES),
  /** Číslo skartačního protokolu / předávacího protokolu archivu. */
  reference: z.string().trim().max(200).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});
export type DisposeInput = z.input<typeof DisposeInput>;

export interface RetentionRow {
  id: string;
  companyId: string;
  code: string | null;
  title: string;
  docType: PolicyType;
  folderPath: string | null;
  versions: number;
  files: number;
  retention: RetentionInfo;
  disposal: PolicyDetail["disposal"];
}

/* ============================================================
 * DMS III (v0.24): převody do PDF, vyhledávání v souborech, porovnání verzí
 * ============================================================ */

/** Stav PDF k souboru: native = soubor je PDF, ok = převedeno, pending = čeká, failed = chyba, none = nepřevádí se. */
export type PdfStatus = "native" | "ok" | "pending" | "failed" | "none";

export type DiffPart = { t: "=" | "+" | "-"; v: string };
export type DiffBlock =
  | { type: "same"; head: string[]; skipped: number; tail: string[] }
  | { type: "add"; lines: string[] }
  | { type: "del"; lines: string[] }
  | { type: "mod"; parts: DiffPart[] };

export interface VersionDiffDto {
  from: { id: string; version: string };
  to: { id: string; version: string };
  blocks: DiffBlock[];
  stats: { added: number; removed: number; changed: number };
  /** Soubory, ze kterých se zatím nepodařilo získat text (porovnání je neúplné). */
  missingText: string[];
  truncated: boolean;
}

/** Výsledek fulltextového hledání v dokumentaci (správa). */
export interface PolicySearchHit {
  id: string;
  companyId: string;
  code: string | null;
  title: string;
  status: PolicyStatus;
  version: string;
  versionStatus: PolicyVersionStatus;
  /** Kde se našlo: název souboru nebo „text verze“. */
  source: string;
  snippet: string;
}

/** Úryvek kolem nálezu (normalizovaný text má stejné pozice jako původní NFC text). */
export function snippetAround(text: string, normalized: string, needle: string, radius = 90): string | null {
  const i = normalized.indexOf(needle);
  if (i < 0) return null;
  const a = Math.max(0, i - radius);
  const b = Math.min(text.length, i + needle.length + radius);
  return `${a > 0 ? "…" : ""}${text.slice(a, b).replace(/\s+/g, " ").trim()}${b < text.length ? "…" : ""}`;
}

/* ============================================================
 * DMS IV (v0.25): úpravy v desktopovém Word / Excel / PowerPoint (WebDAV + Office URI)
 * ============================================================ */

export const OFFICE_APPS = {
  word: { scheme: "ms-word", label: "Word", ext: ["docx", "docm", "doc", "dotx", "rtf", "odt"] },
  excel: { scheme: "ms-excel", label: "Excel", ext: ["xlsx", "xlsm", "xls", "ods", "csv"] },
  powerpoint: { scheme: "ms-powerpoint", label: "PowerPoint", ext: ["pptx", "pptm", "ppt", "odp"] },
} as const;
export type OfficeApp = keyof typeof OFFICE_APPS;

/** Aplikace Office pro soubor (podle přípony), jinak null. */
export function officeAppOf(filename: string): OfficeApp | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  for (const [k, v] of Object.entries(OFFICE_APPS)) if ((v.ext as readonly string[]).includes(ext)) return k as OfficeApp;
  return null;
}

/** Odkaz, kterým prohlížeč otevře soubor v desktopovém Office (ofe = úprava, ofv = jen čtení). */
export function officeUri(app: OfficeApp, mode: "edit" | "view", url: string) {
  return `${OFFICE_APPS[app].scheme}:${mode === "edit" ? "ofe" : "ofv"}|u|${url}`;
}

export const OfficeOpenInput = z.object({ mode: z.enum(["edit", "view"]).default("edit") });
export interface OfficeOpenDto {
  /** ms-word:ofe|u|https://…/dav/<token>/<soubor> */
  uri: string;
  /** WebDAV adresa (pro ruční otevření v Office: Soubor → Otevřít → adresa). */
  url: string;
  app: OfficeApp;
  mode: "edit" | "view";
  expiresAt: string;
}

/* ============================================================
 * Zeptej se dokumentace (v0.27): odpovědi z platných dokumentů s odkazy na zdroj
 * ============================================================ */

export const DocQaInput = z.object({ question: z.string().trim().min(3, "Napište otázku").max(1000) });
export type DocQaInput = z.input<typeof DocQaInput>;

export interface DocQaSource {
  /** Číslo citace v odpovědi [1], [2]… */
  n: number;
  policyId: string;
  code: string | null;
  title: string;
  version: string;
  heading: string | null;
  source: string;
  snippet: string;
}

export interface DocQaAnswerDto {
  answer: string;
  sources: DocQaSource[];
  /** semantic = vektorové hledání, keyword = jen podle slov (embedding není k dispozici). */
  mode: "semantic" | "keyword";
  model: string | null;
  durationMs: number;
}

export interface DocIndexStatusDto {
  enabled: boolean;
  embeddingModel: string;
  /** Platných dokumentů / zaindexovaných / čeká. */
  documents: number;
  indexed: number;
  pending: number;
  chunks: number;
  lastIndexedAt: string | null;
  errors: { policyId: string; title: string; error: string }[];
}
