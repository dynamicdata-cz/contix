import { z } from "zod";
import { patchOf } from "./zutil";

/* ============================================================
 * Akce a úkoly (ADR-043): jednotný přehled nápravných akcí ze všech zdrojů – akce plánu zvládání rizik,
 * nápravná opatření ze zjištění auditů, úkoly ze změn předpisů a samostatné úkoly (tabulka `tasks`),
 * které lze navázat na libovolný záznam (incident, dodavatel, změna, opatření…). Přehled se počítá při čtení.
 * ============================================================ */

export const TASK_STATUSES = ["open", "in_progress", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_PRIORITIES = ["low", "medium", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Druh záznamu, ke kterému je úkol navázán (null = samostatný úkol). */
export const TASK_SOURCES = ["incident", "supplier", "change", "control", "asset", "process", "risk", "policy", "audit", "processing", "isms_review", "soc_alert", "exercise", "info_item", "ai_system", "cra_product", "soc2"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

/** Druhy akcí v jednotném přehledu. */
export const ACTION_KINDS = ["task", "risk_action", "audit_finding", "legal_task"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const TASK_LABELS = {
  kind: { task: "Úkol", risk_action: "Akce plánu zvládání rizik", audit_finding: "Nápravné opatření z auditu", legal_task: "Úkol ze změny předpisu" } satisfies Record<ActionKind, string>,
  status: { open: "Otevřeno", in_progress: "Rozpracováno", done: "Splněno", cancelled: "Zrušeno" } satisfies Record<TaskStatus, string>,
  priority: { low: "Nízká", medium: "Střední", high: "Vysoká" } satisfies Record<TaskPriority, string>,
  source: {
    incident: "Incident",
    supplier: "Dodavatel",
    change: "Změna",
    control: "Opatření",
    asset: "Aktivum",
    process: "Proces",
    risk: "Riziko",
    policy: "Dokument",
    audit: "Audit",
    processing: "Činnost zpracování",
    isms_review: "Přezkoumání ISMS",
    soc_alert: "Alert SOC",
    exercise: "Cvičení",
    info_item: "Informační servis",
    ai_system: "AI systém",
    cra_product: "Produkt (CRA)",
    soc2: "Zakázka SOC 2",
  } satisfies Record<TaskSource, string>,
} as const;

/** Odkaz na zdrojový záznam úkolu v aplikaci. */
export function taskSourceLink(kind: TaskSource | null, id: string | null): string | null {
  if (!kind || !id) return kind === "isms_review" ? "/isms" : null;
  const map: Record<TaskSource, string> = {
    incident: `/incidents/${id}`,
    supplier: `/suppliers/${id}`,
    change: `/isms/changes/${id}`,
    control: `/controls/${id}`,
    asset: `/assets/${id}`,
    process: `/processes/${id}`,
    risk: `/risks/${id}`,
    policy: `/policies/${id}`,
    audit: `/audits/${id}`,
    processing: `/gdpr/${id}`,
    isms_review: "/isms",
    soc_alert: `/soc/${id}`,
    exercise: `/continuity/exercises/${id}`,
    info_item: "/infoservice",
    ai_system: `/aiact/${id}`,
    cra_product: `/cra/${id}`,
    soc2: `/soc2/${id}`,
  };
  return map[kind];
}

const date = z.string().date().nullable().optional();

export const TaskInput = z.object({
  /** Společnost skupiny (výchozí = aktivní společnost, u navázaného úkolu společnost zdroje). */
  companyId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(10000).optional().nullable(),
  sourceKind: z.enum(TASK_SOURCES).nullable().optional(),
  sourceId: z.string().uuid().nullable().optional(),
  ownerPositionId: z.string().uuid().nullable().optional(),
  dueDate: date,
  priority: z.enum(TASK_PRIORITIES).default("medium"),
  status: z.enum(TASK_STATUSES).default("open"),
  completionNote: z.string().trim().max(4000).optional().nullable(),
});
export type TaskInput = z.input<typeof TaskInput>;
export const TaskPatch = patchOf(TaskInput.omit({ companyId: true, sourceKind: true, sourceId: true }));
export type TaskPatch = z.input<typeof TaskPatch>;

export interface TaskDto {
  id: string;
  companyId: string;
  code: string;
  title: string;
  description: string | null;
  sourceKind: TaskSource | null;
  sourceId: string | null;
  sourceLabel: string | null;
  sourceLink: string | null;
  ownerPositionId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  completedAt: string | null;
  completionNote: string | null;
  createdByName: string | null;
  createdAt: string;
  /** Smí uživatel úkol upravit (správce úkolů, nebo držitel funkčního místa vlastníka – jen stav a poznámku). */
  canEdit: boolean;
  canManage: boolean;
}

/** Položka jednotného přehledu akcí. */
export interface ActionItem {
  key: string;
  kind: ActionKind;
  id: string;
  companyId: string;
  title: string;
  /** Odkud akce pochází (riziko, audit, předpis, zdroj úkolu). */
  source: string | null;
  link: string;
  ownerPositionId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  status: TaskStatus;
  priority: TaskPriority | null;
  completedAt: string | null;
  overdue: boolean;
}

export interface ActionSummary {
  open: number;
  overdue: number;
  dueSoon: number;
  doneLast30: number;
  byKind: Record<ActionKind, number>;
}

/** Nedokončená akce s termínem v minulosti. */
export const actionOverdue = (a: { status: TaskStatus; dueDate: string | null }, today: string) => (a.status === "open" || a.status === "in_progress") && !!a.dueDate && a.dueDate < today;

export function summarizeActions(items: ActionItem[], today: string): ActionSummary {
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 30);
  const soonStr = soon.toISOString().slice(0, 10);
  const past = new Date(`${today}T00:00:00Z`);
  past.setUTCDate(past.getUTCDate() - 30);
  const byKind = Object.fromEntries(ACTION_KINDS.map((k) => [k, 0])) as Record<ActionKind, number>;
  let open = 0;
  let overdue = 0;
  let dueSoon = 0;
  let doneLast30 = 0;
  for (const a of items) {
    const active = a.status === "open" || a.status === "in_progress";
    if (active) {
      open++;
      byKind[a.kind]++;
      if (a.dueDate && a.dueDate < today) overdue++;
      else if (a.dueDate && a.dueDate <= soonStr) dueSoon++;
    } else if (a.status === "done" && a.completedAt && a.completedAt.slice(0, 10) >= past.toISOString().slice(0, 10)) doneLast30++;
  }
  return { open, overdue, dueSoon, doneLast30, byKind };
}

/** Řazení: po termínu, pak podle termínu (bez termínu na konec), hotové na konec. */
export function sortActions(items: ActionItem[]): ActionItem[] {
  const rank = (a: ActionItem) => (a.status === "done" || a.status === "cancelled" ? 2 : a.overdue ? 0 : 1);
  return [...items].sort((a, b) => rank(a) - rank(b) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.title.localeCompare(b.title));
}
