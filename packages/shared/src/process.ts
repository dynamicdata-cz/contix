import { z } from "zod";
import { patchOf } from "./zutil";

/* ============================================================
 * Procesy: procesní karta, hierarchie, kroky, RACI, vazby, BPMN
 * ============================================================ */

export const PROCESS_TYPES = ["management", "core", "support"] as const;
export const ProcessType = z.enum(PROCESS_TYPES);
export type ProcessType = z.infer<typeof ProcessType>;

export const PROCESS_STATUSES = ["draft", "active", "retired"] as const;
export const ProcessStatus = z.enum(PROCESS_STATUSES);
export type ProcessStatus = z.infer<typeof ProcessStatus>;

export const STEP_TYPES = ["task", "decision", "subprocess", "event"] as const;
export const StepType = z.enum(STEP_TYPES);
export type StepType = z.infer<typeof StepType>;

export const RACI = ["R", "A", "C", "I"] as const;
export const Raci = z.enum(RACI);
export type Raci = z.infer<typeof Raci>;

export const PROCESS_LABELS = {
  type: { management: "Řídicí", core: "Hlavní (klíčový)", support: "Podpůrný" } satisfies Record<ProcessType, string>,
  status: { draft: "Návrh", active: "Platný", retired: "Zrušený" } satisfies Record<ProcessStatus, string>,
  stepType: { task: "Činnost", decision: "Rozhodnutí", subprocess: "Podproces", event: "Událost" } satisfies Record<StepType, string>,
  raci: {
    R: "Provádí (Responsible)",
    A: "Schvaluje / odpovídá (Accountable)",
    C: "Konzultován (Consulted)",
    I: "Informován (Informed)",
  } satisfies Record<Raci, string>,
} as const;

const text = (max = 5000) => z.string().trim().max(max).optional().nullable();

export const ProcessInput = z.object({
  /** Společnost skupiny, do které záznam patří (výchozí = aktivní společnost). */
  companyId: z.string().uuid().optional(),
  parentId: z.string().uuid().nullable().optional(),
  code: z.string().trim().max(50).optional().nullable(),
  name: z.string().trim().min(1).max(255),
  processType: ProcessType.default("core"),
  status: ProcessStatus.default("draft"),
  purpose: text(),
  description: text(20000),
  trigger: text(),
  inputs: text(),
  outputs: text(),
  kpis: text(),
  frequency: text(255),
  legislation: text(),
  ownerPositionId: z.string().uuid().nullable().optional(),
  orgUnitId: z.string().uuid().nullable().optional(),
  criticality: z.enum(["low", "medium", "high", "critical"]).default("medium"),
});
export type ProcessInput = z.input<typeof ProcessInput>;
export const ProcessPatch = patchOf(ProcessInput.omit({ companyId: true }));

export const StepInput = z.object({
  name: z.string().trim().min(1).max(255),
  stepType: StepType.default("task"),
  description: text(20000),
  inputs: text(),
  outputs: text(),
  duration: text(255),
  systems: text(1000),
  raci: z
    .array(z.object({ kind: z.enum(["position", "org_unit"]), id: z.string().uuid(), role: Raci }))
    .default([]),
  assetIds: z.array(z.string().uuid()).default([]),
});
export type StepInput = z.input<typeof StepInput>;
export const StepPatch = patchOf(StepInput);

export const ReorderStepsInput = z.object({ stepIds: z.array(z.string().uuid()).min(1) });

export const ProcessDocumentInput = z.object({
  title: z.string().trim().min(1).max(500),
  url: z.string().trim().max(2000).optional().nullable(),
  docType: z.string().trim().max(100).optional().nullable(),
  stepId: z.string().uuid().nullable().optional(),
});

export const ProcessAssetsInput = z.object({ assetIds: z.array(z.string().uuid()) });

export const BpmnInput = z.object({ xml: z.string().max(5_000_000) });

export interface RaciDto {
  kind: "position" | "org_unit";
  id: string;
  role: Raci;
  name: string;
  orgUnitName?: string | null;
}

export interface StepDto {
  id: string;
  processId: string;
  order: number;
  name: string;
  stepType: StepType;
  description: string | null;
  inputs: string | null;
  outputs: string | null;
  duration: string | null;
  systems: string | null;
  raci: RaciDto[];
  assets: { id: string; name: string; assetType: string; healthStatus: string }[];
}

export interface ProcessListItem {
  id: string;
  companyId: string;
  parentId: string | null;
  code: string | null;
  name: string;
  processType: ProcessType;
  status: ProcessStatus;
  criticality: string;
  ownerPositionName: string | null;
  orgUnitName: string | null;
  stepCount: number;
  riskCount: number;
  updatedAt: string;
}

export interface ProcessDetail extends Omit<ProcessListItem, "stepCount" | "riskCount"> {
  purpose: string | null;
  description: string | null;
  trigger: string | null;
  inputs: string | null;
  outputs: string | null;
  kpis: string | null;
  frequency: string | null;
  legislation: string | null;
  ownerPositionId: string | null;
  orgUnitId: string | null;
  ownerHolders: { id: string; displayName: string }[];
  hasBpmn: boolean;
  version: number;
  steps: StepDto[];
  assets: { id: string; name: string; assetType: string; assetClass: string; healthStatus: string; viaSteps: boolean }[];
  documents: { id: string; title: string; url: string | null; docType: string | null; stepId: string | null }[];
  risks: { id: string; code: string | null; name: string; level: string; status: string }[];
  children: { id: string; code: string | null; name: string; status: ProcessStatus }[];
  canEdit: boolean;
}
