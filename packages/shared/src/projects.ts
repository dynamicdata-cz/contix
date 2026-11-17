import { z } from "zod";

/* ============================================================
 * Projektové řízení s fázemi a branami (v1.31, ADR-128): projekt prochází fázemi; každá fáze má požadované dokumenty
 * a končí branou (gate), kterou schvaluje sponzor – jen když jsou povinné dokumenty schválené nebo „netýká se“.
 * Bezpečnost v projektech: § 13 vyhl. 409/2025 (bezpečnost při akvizici, vývoji a údržbě), ISO 27001 A.5.8.
 * ============================================================ */

export const PROJECT_STATUSES = ["active", "on_hold", "closed", "cancelled"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PHASE_STATUSES = ["planned", "active", "approved"] as const;
export type PhaseStatus = (typeof PHASE_STATUSES)[number];

export const DOC_REQ_STATUSES = ["missing", "submitted", "approved", "rejected", "na"] as const;
export type DocReqStatus = (typeof DOC_REQ_STATUSES)[number];

export interface ProjectTemplate {
  key: string;
  name: string;
  phases: { key: string; name: string; docs: { name: string; required: boolean; security?: boolean }[] }[];
}

/** Vestavěné šablony; dokumenty s `security` jsou bezpečnostní požadavky (security by design). */
export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    key: "it",
    name: "IT projekt (zavedení nebo změna informačního systému)",
    phases: [
      { key: "init", name: "Iniciace", docs: [{ name: "Projektový záměr (cíle, rozsah, přínosy)", required: true }, { name: "Prvotní posouzení dopadu na bezpečnost a osobní údaje", required: true, security: true }] },
      {
        key: "plan",
        name: "Plánování",
        docs: [
          { name: "Projektový plán (harmonogram, rozpočet, role)", required: true },
          { name: "Bezpečnostní požadavky na řešení", required: true, security: true },
          { name: "Analýza rizik projektu", required: true, security: true },
          { name: "Posouzení vlivu na ochranu osobních údajů (DPIA), je-li třeba", required: false, security: true },
        ],
      },
      {
        key: "build",
        name: "Realizace",
        docs: [
          { name: "Návrh řešení a architektura", required: true },
          { name: "Smlouva s dodavatelem s bezpečnostními požadavky", required: false, security: true },
        ],
      },
      { key: "test", name: "Testování", docs: [{ name: "Protokol z akceptačních testů", required: true }, { name: "Bezpečnostní test / penetrační test a řešení nálezů", required: true, security: true }] },
      {
        key: "handover",
        name: "Předání do provozu",
        docs: [
          { name: "Předávací protokol", required: true },
          { name: "Provozní a bezpečnostní dokumentace", required: true, security: true },
          { name: "Aktualizace evidence aktiv a rizik", required: true, security: true },
          { name: "Plán zálohování a obnovy", required: true, security: true },
        ],
      },
      { key: "close", name: "Uzavření", docs: [{ name: "Závěrečná zpráva projektu", required: true }, { name: "Vyhodnocení a poučení (lessons learned)", required: false }] },
    ],
  },
  {
    key: "security",
    name: "Bezpečnostní projekt (zavedení opatření)",
    phases: [
      { key: "analysis", name: "Analýza", docs: [{ name: "Zadání a vazba na riziko / opatření", required: true, security: true }, { name: "Analýza současného stavu", required: true }] },
      { key: "design", name: "Návrh", docs: [{ name: "Návrh opatření a jeho účinnosti", required: true, security: true }, { name: "Plán zavedení", required: true }] },
      { key: "impl", name: "Zavedení", docs: [{ name: "Dokumentace konfigurace", required: true, security: true }, { name: "Školení dotčených osob", required: false }] },
      { key: "verify", name: "Ověření účinnosti", docs: [{ name: "Test účinnosti opatření", required: true, security: true }, { name: "Aktualizace prohlášení o aplikovatelnosti", required: true, security: true }] },
    ],
  },
  {
    key: "procurement",
    name: "Pořízení (nákup služby nebo produktu)",
    phases: [
      { key: "need", name: "Potřeba", docs: [{ name: "Zdůvodnění potřeby a požadavky", required: true }, { name: "Bezpečnostní požadavky na dodavatele", required: true, security: true }] },
      { key: "select", name: "Výběr dodavatele", docs: [{ name: "Hodnocení nabídek", required: true }, { name: "Posouzení dodavatele (významný dodavatel?)", required: true, security: true }] },
      { key: "contract", name: "Smlouva", docs: [{ name: "Smlouva s náležitostmi dle vyhlášky (příloha smluvních ujednání)", required: true, security: true }] },
      { key: "onboard", name: "Převzetí", docs: [{ name: "Předávací protokol", required: true }, { name: "Zařazení do evidence dodavatelů a aktiv", required: true, security: true }] },
    ],
  },
];

export const PROJECT_LABELS = {
  status: { active: "Probíhá", on_hold: "Pozastaveno", closed: "Uzavřeno", cancelled: "Zrušeno" } satisfies Record<ProjectStatus, string>,
  phase: { planned: "Plánováno", active: "Probíhá", approved: "Brána schválena" } satisfies Record<PhaseStatus, string>,
  doc: { missing: "Chybí", submitted: "Ke schválení", approved: "Schváleno", rejected: "Vráceno", na: "Netýká se" } satisfies Record<DocReqStatus, string>,
};

/** Lze schválit bránu? Povinné dokumenty musí být schválené nebo „netýká se“ (s důvodem). */
export function gateBlockers(docs: { name: string; required: boolean; status: DocReqStatus }[]): string[] {
  return docs.filter((d) => d.required && d.status !== "approved" && d.status !== "na").map((d) => d.name);
}

const opt = (n: number) => z.string().trim().max(n).nullable().optional().transform((v) => v || null);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().transform((v) => v || null);

export const ProjectInput = z.object({
  code: opt(50),
  name: z.string().trim().min(1).max(300),
  description: opt(5000),
  templateKey: z.string().trim().min(1).max(60),
  managerId: z.string().uuid().nullable().optional().transform((v) => v || null),
  sponsorId: z.string().uuid().nullable().optional().transform((v) => v || null),
  startDate: isoDate,
  endDate: isoDate,
  /** Rozpočet v Kč; null = nesleduje se (v1.32). */
  budget: z.number().min(0).max(1e12).nullable().optional().transform((v) => v ?? null),
});
export type ProjectInput = z.input<typeof ProjectInput>;
export const ProjectPatch = ProjectInput.omit({ templateKey: true }).partial().extend({ status: z.enum(PROJECT_STATUSES).optional() });
export type ProjectPatch = z.input<typeof ProjectPatch>;

export const PhasePatch = z
  .object({ plannedStart: isoDate, plannedEnd: isoDate })
  .partial()
  .refine((v) => !v.plannedStart || !v.plannedEnd || v.plannedStart <= v.plannedEnd, { message: "Začátek fáze musí být před jejím koncem" });
export const DocReqInput = z.object({ name: z.string().trim().min(1).max(300), required: z.boolean().default(true) });
export const DocReqUpdate = z.object({
  status: z.enum(DOC_REQ_STATUSES).optional(),
  note: opt(2000),
  url: z.string().trim().url().max(1000).nullable().optional().or(z.literal("").transform(() => null)),
});
export const GateDecisionInput = z.object({ comment: opt(2000) });

export interface DocReqDto {
  id: string;
  name: string;
  required: boolean;
  security: boolean;
  status: DocReqStatus;
  note: string | null;
  url: string | null;
  fileName: string | null;
  fileSize: number | null;
  updatedByName: string | null;
  updatedAt: string | null;
  /** Smí aktuální uživatel předložený dokument schválit / vrátit (není předkladatel). */
  canReview: boolean;
}

export interface PhaseDto {
  id: string;
  order: number;
  name: string;
  status: PhaseStatus;
  plannedStart: string | null;
  plannedEnd: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  gateComment: string | null;
  overdue: boolean;
  docs: DocReqDto[];
  blockers: string[];
}

export interface ProjectDto {
  id: string;
  companyId: string;
  code: string | null;
  name: string;
  description: string | null;
  templateKey: string;
  templateName: string;
  status: ProjectStatus;
  managerId: string | null;
  managerName: string | null;
  sponsorId: string | null;
  sponsorName: string | null;
  startDate: string | null;
  endDate: string | null;
  currentPhase: string | null;
  progress: { phases: number; approved: number; docs: number; docsDone: number };
  budget: number | null;
  spent: number;
  budgetState: BudgetState;
  overdue: boolean;
  createdAt: string;
  /** Portfolio (v1.35). */
  info: ProjectPortfolioInfo;
}

export interface ProjectDetailDto extends ProjectDto {
  phases: PhaseDto[];
  costs: ProjectCostDto[];
  canEdit: boolean;
  canApproveGate: boolean;
  /* v1.35 */
  members: ProjectMemberDto[];
  tasks: ProjectTaskDto[];
  milestones: MilestoneDto[];
  issues: ProjectIssueDto[];
  reports: StatusReportDto[];
  changes: ChangeRequestDto[];
  lessons: LessonDto[];
  suggested: { schedule: Rag; budget: Rag; scope: Rag; overall: Rag };
  /** Smí uživatel podat hlášení stavu (manažer nebo projects:write). */
  canReport: boolean;
}

/* ---------------- harmonogram, rozpočet, vlastní šablony, vazby (v1.32, ADR-129) ---------------- */

export type BudgetState = "none" | "ok" | "warn" | "over";
/** Stav čerpání: varování od 90 %, překročení nad 100 %. */
export function budgetState(budget: number | null, spent: number): BudgetState {
  if (budget === null || budget === undefined) return "none";
  if (spent > budget) return "over";
  if (budget > 0 && spent >= budget * 0.9) return "warn";
  return "ok";
}

export const ProjectCostInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().min(1).max(500),
  /** Kč; záporná částka = dobropis / vrácení. */
  amount: z.number().min(-1e12).max(1e12).refine((v) => v !== 0, "Částka nesmí být nulová"),
  phaseId: z.string().uuid().nullable().optional().transform((v) => v || null),
  supplierId: z.string().uuid().nullable().optional().transform((v) => v || null),
});
export type ProjectCostInput = z.input<typeof ProjectCostInput>;

export interface ProjectCostDto {
  id: string;
  date: string;
  description: string;
  amount: number;
  phaseId: string | null;
  phaseName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  createdByName: string | null;
}

export const PROJECT_TEMPLATE_PREFIX = "custom:";

const TemplateDoc = z.object({ name: z.string().trim().min(1).max(300), required: z.boolean().default(true), security: z.boolean().default(false) });
export const ProjectTemplateInput = z.object({
  name: z.string().trim().min(1).max(200),
  phases: z
    .array(z.object({ name: z.string().trim().min(1).max(200), docs: z.array(TemplateDoc).max(50).default([]) }))
    .min(1, "Šablona musí mít alespoň jednu fázi")
    .max(20),
  active: z.boolean().default(true),
});
export type ProjectTemplateInput = z.input<typeof ProjectTemplateInput>;

export interface ProjectTemplateDto extends ProjectTemplate {
  /** Vlastní šablona organizace (upravitelná) vs. vestavěná. */
  custom: boolean;
  id: string | null;
  companyId: string | null;
  active: boolean;
}

/** Úsek časové osy (Gantt): fáze nebo projekt; skutečný konec = schválení brány. */
export interface TimelineBar {
  id: string;
  label: string;
  start: string | null;
  end: string | null;
  actualEnd: string | null;
  status: string;
}

/** Rozsah časové osy (min začátek – max konec / dnešek), pro procentní umístění pruhů. */
export function timelineRange(bars: TimelineBar[], today: string): { from: string; to: string; days: number } | null {
  const dates = bars.flatMap((b) => [b.start, b.end, b.actualEnd]).filter((d): d is string => !!d);
  if (!dates.length) return null;
  const from = [...dates, today].sort()[0]!;
  const to = [...dates, today].sort().at(-1)!;
  const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000));
  return { from, to, days };
}

/** Pozice dne na ose v procentech. */
export const timelinePct = (date: string, r: { from: string; days: number }) => Math.min(100, Math.max(0, ((Date.parse(date) - Date.parse(r.from)) / 86_400_000 / r.days) * 100));

/* ---------------- tým, úkoly, milníky, rizika a problémy, stav (RAG), změny, poučení (v1.35, ADR-132) ---------------- */

export const PROJECT_TASK_STATUSES = ["todo", "doing", "blocked", "done"] as const;
export type ProjectTaskStatus = (typeof PROJECT_TASK_STATUSES)[number];
export const PROJECT_PRIORITIES = ["low", "medium", "high"] as const;
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number];
export const PROJECT_RACI = ["R", "A", "C", "I"] as const;
export type ProjectRaci = (typeof PROJECT_RACI)[number];
export const ISSUE_KINDS = ["risk", "issue"] as const;
export type IssueKind = (typeof ISSUE_KINDS)[number];
export const ISSUE_STATUSES = ["open", "mitigating", "closed"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export const RAG = ["green", "amber", "red"] as const;
export type Rag = (typeof RAG)[number];
export const PROJECT_CHANGE_STATUSES = ["submitted", "approved", "rejected"] as const;
export type ProjectChangeStatus = (typeof PROJECT_CHANGE_STATUSES)[number];
export const LESSON_KINDS = ["went_well", "improve"] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];

export const PROJECT_LABELS2 = {
  task: { todo: "K řešení", doing: "Probíhá", blocked: "Blokováno", done: "Hotovo" } satisfies Record<ProjectTaskStatus, string>,
  priority: { low: "Nízká", medium: "Střední", high: "Vysoká" } satisfies Record<ProjectPriority, string>,
  raci: { R: "Řeší (R)", A: "Odpovídá (A)", C: "Konzultuje (C)", I: "Informován (I)" } satisfies Record<ProjectRaci, string>,
  issueKind: { risk: "Riziko", issue: "Problém" } satisfies Record<IssueKind, string>,
  issueStatus: { open: "Otevřené", mitigating: "Řeší se", closed: "Uzavřené" } satisfies Record<IssueStatus, string>,
  rag: { green: "V pořádku", amber: "Pozor", red: "Kritické" } satisfies Record<Rag, string>,
  change: { submitted: "Ke schválení", approved: "Schváleno", rejected: "Zamítnuto" } satisfies Record<ProjectChangeStatus, string>,
  lesson: { went_well: "Co se osvědčilo", improve: "Co zlepšit" } satisfies Record<LessonKind, string>,
};

const uuidOpt = z.string().uuid().nullable().optional().transform((v) => v || null);

export const ProjectMemberInput = z.object({ userId: z.string().uuid(), role: z.string().trim().min(1).max(100), raci: z.enum(PROJECT_RACI).default("R") });
export type ProjectMemberInput = z.input<typeof ProjectMemberInput>;
export interface ProjectMemberDto {
  id: string;
  userId: string;
  name: string;
  role: string;
  raci: ProjectRaci;
}

export const ProjectTaskInput = z.object({
  title: z.string().trim().min(1).max(300),
  description: opt(5000),
  phaseId: uuidOpt,
  assigneeId: uuidOpt,
  dueDate: isoDate,
  priority: z.enum(PROJECT_PRIORITIES).default("medium"),
  status: z.enum(PROJECT_TASK_STATUSES).default("todo"),
});
export type ProjectTaskInput = z.input<typeof ProjectTaskInput>;
/** Úprava úkolu – bez výchozích hodnot (nepřepíše neposlaná pole). */
/** Volitelné pole bez výchozí hodnoty: neposlané zůstane undefined (nepřepíše se), prázdné = null. */
const keep = <T extends z.ZodTypeAny>(t: T) => t.nullable().optional().transform((v) => (v === undefined ? undefined : v || null));
export const ProjectTaskPatch = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: keep(z.string().trim().max(5000)),
  phaseId: keep(z.string().uuid().or(z.literal(""))),
  assigneeId: keep(z.string().uuid().or(z.literal(""))),
  dueDate: keep(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal(""))),
  priority: z.enum(PROJECT_PRIORITIES).optional(),
  status: z.enum(PROJECT_TASK_STATUSES).optional(),
  order: z.number().int().min(0).max(100000).optional(),
});
export type ProjectTaskPatch = z.input<typeof ProjectTaskPatch>;
export interface ProjectTaskDto {
  id: string;
  title: string;
  description: string | null;
  phaseId: string | null;
  phaseName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  priority: ProjectPriority;
  status: ProjectTaskStatus;
  order: number;
  overdue: boolean;
  doneAt: string | null;
  /** Smí aktuální uživatel měnit stav (správce projektu nebo řešitel). */
  canMove: boolean;
}

export const MilestoneInput = z.object({ name: z.string().trim().min(1).max(200), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), phaseId: uuidOpt, done: z.boolean().default(false) });
export type MilestoneInput = z.input<typeof MilestoneInput>;
export interface MilestoneDto {
  id: string;
  name: string;
  dueDate: string;
  phaseId: string | null;
  doneAt: string | null;
  overdue: boolean;
}

export const ProjectIssueInput = z.object({
  kind: z.enum(ISSUE_KINDS).default("risk"),
  title: z.string().trim().min(1).max(300),
  description: opt(5000),
  /** Pravděpodobnost jen u rizika (problém už nastal). */
  probability: z.enum(PROJECT_PRIORITIES).nullable().optional().transform((v) => v ?? null),
  impact: z.enum(PROJECT_PRIORITIES).default("medium"),
  ownerId: uuidOpt,
  status: z.enum(ISSUE_STATUSES).default("open"),
  response: opt(5000),
  dueDate: isoDate,
});
export type ProjectIssueInput = z.input<typeof ProjectIssueInput>;
export interface ProjectIssueDto {
  id: string;
  kind: IssueKind;
  title: string;
  description: string | null;
  probability: ProjectPriority | null;
  impact: ProjectPriority;
  score: number;
  level: ProjectPriority;
  ownerId: string | null;
  ownerName: string | null;
  status: IssueStatus;
  response: string | null;
  dueDate: string | null;
  overdue: boolean;
}

const LV: Record<ProjectPriority, number> = { low: 1, medium: 2, high: 3 };
/** Skóre rizika / problému 1–9 (problém = pravděpodobnost 3, už nastal) a úroveň. */
export function issueScore(kind: IssueKind, probability: ProjectPriority | null, impact: ProjectPriority): { score: number; level: ProjectPriority } {
  const score = (kind === "issue" ? 3 : LV[probability ?? "medium"]) * LV[impact];
  return { score, level: score >= 6 ? "high" : score >= 3 ? "medium" : "low" };
}

export const StatusReportInput = z.object({
  overall: z.enum(RAG),
  schedule: z.enum(RAG),
  budget: z.enum(RAG),
  scope: z.enum(RAG),
  summary: z.string().trim().min(3).max(5000),
  achievements: opt(5000),
  nextSteps: opt(5000),
});
export type StatusReportInput = z.input<typeof StatusReportInput>;
export interface StatusReportDto {
  id: string;
  date: string;
  overall: Rag;
  schedule: Rag;
  budget: Rag;
  scope: Rag;
  summary: string;
  achievements: string | null;
  nextSteps: string | null;
  createdByName: string | null;
}

/** Návrh semaforu z dat projektu (manažer ho při hlášení potvrdí nebo změní). */
export function suggestRag(o: { overduePhases: number; overdueMilestones: number; overdueTasks: number; blockedTasks: number; budgetState: BudgetState; highIssues: number; pendingChanges: number; projectOverdue: boolean }): { schedule: Rag; budget: Rag; scope: Rag; overall: Rag } {
  const schedule: Rag = o.projectOverdue || o.overduePhases > 0 || o.overdueMilestones > 1 ? "red" : o.overdueMilestones > 0 || o.overdueTasks > 0 || o.blockedTasks > 0 ? "amber" : "green";
  const budget: Rag = o.budgetState === "over" ? "red" : o.budgetState === "warn" ? "amber" : "green";
  const scope: Rag = o.highIssues > 1 ? "red" : o.highIssues > 0 || o.pendingChanges > 0 ? "amber" : "green";
  const all = [schedule, budget, scope];
  const overall: Rag = all.includes("red") ? "red" : all.includes("amber") ? "amber" : "green";
  return { schedule, budget, scope, overall };
}

export const ChangeRequestInput = z
  .object({
    title: z.string().trim().min(3).max(300),
    description: z.string().trim().min(3).max(5000),
    /** Nový termín konce projektu. */
    newEndDate: isoDate,
    /** Změna rozpočtu v Kč (+ navýšení, − snížení). */
    budgetDelta: z.number().min(-1e12).max(1e12).nullable().optional().transform((v) => (v ? v : null)),
    scope: opt(5000),
  })
  .refine((v) => v.newEndDate || v.budgetDelta || v.scope, { message: "Změna musí měnit termín, rozpočet nebo rozsah" });
export type ChangeRequestInput = z.input<typeof ChangeRequestInput>;
export const ChangeDecisionInput = z.object({ decision: z.enum(["approved", "rejected"]), comment: opt(2000) });
export interface ChangeRequestDto {
  id: string;
  number: number;
  title: string;
  description: string;
  newEndDate: string | null;
  oldEndDate: string | null;
  budgetDelta: number | null;
  scope: string | null;
  status: ProjectChangeStatus;
  requestedByName: string | null;
  createdAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  comment: string | null;
  canDecide: boolean;
}

export const LessonInput = z.object({ kind: z.enum(LESSON_KINDS), text: z.string().trim().min(3).max(2000) });
export interface LessonDto {
  id: string;
  kind: LessonKind;
  text: string;
  createdByName: string | null;
  createdAt: string;
}

/** Souhrn pro portfolio (v1.35). */
export interface ProjectPortfolioInfo {
  rag: Rag | null;
  ragDate: string | null;
  suggestedRag: Rag;
  tasks: { open: number; overdue: number; blocked: number; done: number };
  issues: { open: number; high: number };
  nextMilestone: { name: string; dueDate: string } | null;
  pendingChanges: number;
  gateReady: boolean;
}
