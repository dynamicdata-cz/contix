import { z } from "zod";
import { ATTACK_ID_RE, playbookFor, SOC_PLAYBOOKS, type SocPlaybook } from "./soc";
import { patchOf } from "./zutil";

/* ============================================================
 * Playbooky s úkoly pro tým (v0.65, ADR-060): vlastní playbooky společnosti (kroky s odpovědným
 * funkčním místem a lhůtou v hodinách) a rozdělení kroků alertu na úkoly v „Akce a úkoly“.
 * Splnění úkolu označí krok playbooku jako hotový.
 * ============================================================ */

export const CUSTOM_PLAYBOOK_PREFIX = "c:";
export const customPlaybookKey = (id: string) => `${CUSTOM_PLAYBOOK_PREFIX}${id}`;
export const customPlaybookId = (key: string | null | undefined) => (key?.startsWith(CUSTOM_PLAYBOOK_PREFIX) ? key.slice(CUSTOM_PLAYBOOK_PREFIX.length) : null);

const TACTIC_RE = /^TA\d{4}$/;

export interface SocPlaybookStep {
  text: string;
  /** Anglický text (jen vestavěné playbooky). */
  textEn: string | null;
  ownerPositionId: string | null;
  /** Lhůta kroku od zadání úkolu (h). */
  dueHours: number | null;
}
export interface SocPlaybookView {
  key: string;
  name: string;
  nameEn: string | null;
  custom: boolean;
  techniques: string[];
  tactics: string[];
  steps: SocPlaybookStep[];
}

export interface SocPlaybookDto extends SocPlaybookView {
  id: string;
  companyId: string;
  description: string;
  enabled: boolean;
  /** Vestavěný playbook, ze kterého vznikl. */
  basedOn: string | null;
  updatedAt: string;
}

export interface SocPlaybookTask {
  step: number;
  taskId: string;
  seq: number;
  status: string;
  ownerPositionId: string | null;
  ownerPositionName: string | null;
  dueDate: string | null;
}

const StepInput = z.object({
  text: z.string().trim().min(3).max(500),
  ownerPositionId: z.string().uuid().nullable().default(null),
  dueHours: z.number().int().min(1).max(24 * 90).nullable().default(null),
});
export const SocPlaybookInput = z.object({
  name: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).default(""),
  techniques: z.array(z.string().trim().toUpperCase().regex(ATTACK_ID_RE)).max(30).default([]),
  tactics: z.array(z.string().trim().toUpperCase().regex(TACTIC_RE)).max(14).default([]),
  steps: z.array(StepInput).min(1).max(30),
  enabled: z.boolean().default(true),
  basedOn: z.string().trim().max(40).nullable().optional(),
  companyId: z.string().uuid().optional(),
});
export type SocPlaybookInput = z.input<typeof SocPlaybookInput>;
export const SocPlaybookPatch = patchOf(SocPlaybookInput.omit({ companyId: true }));
export type SocPlaybookPatch = z.input<typeof SocPlaybookPatch>;

/** Zadání úkolů z kroků playbooku alertu. */
export const SocPlaybookTasksInput = z.object({
  steps: z
    .array(z.object({ index: z.number().int().min(0).max(29), ownerPositionId: z.string().uuid().nullable(), dueDate: z.string().date().nullable() }))
    .min(1)
    .max(30),
});
export type SocPlaybookTasksInput = z.input<typeof SocPlaybookTasksInput>;

export function builtinView(p: SocPlaybook): SocPlaybookView {
  return {
    key: p.key,
    name: p.name.cs,
    nameEn: p.name.en,
    custom: false,
    techniques: p.techniques,
    tactics: p.tactics,
    steps: p.steps.map((s) => ({ text: s.cs, textEn: s.en, ownerPositionId: null, dueHours: null })),
  };
}

/** Playbook podle klíče (vlastní mají přednost jen podle klíče „c:<id>“). */
export function playbookView(key: string | null | undefined, custom: SocPlaybookView[]): SocPlaybookView | null {
  if (!key) return null;
  const c = custom.find((x) => x.key === key);
  if (c) return c;
  const b = SOC_PLAYBOOKS.find((p) => p.key === key);
  return b ? builtinView(b) : null;
}

/** Návrh playbooku: nejdřív vlastní (technika, pak taktika), jinak vestavěný (`playbookFor`). */
export function pickPlaybook(techniqueIds: string[], tacticIds: string[], custom: SocPlaybookView[]): SocPlaybookView {
  const base = techniqueIds.map((t) => t.split(".")[0]!);
  const byTech = custom.find((p) => p.techniques.some((t) => techniqueIds.includes(t) || base.includes(t.split(".")[0]!)));
  if (byTech) return byTech;
  const byTactic = custom.find((p) => p.tactics.some((t) => tacticIds.includes(t)));
  if (byTactic) return byTactic;
  return builtinView(playbookFor(techniqueIds, tacticIds));
}

/** Termín úkolu z lhůty kroku (h) – datum. */
export function stepDueDate(dueHours: number | null, from = new Date()): string | null {
  if (dueHours == null) return null;
  return new Date(from.getTime() + dueHours * 3600_000).toISOString().slice(0, 10);
}
