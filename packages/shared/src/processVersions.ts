import { z } from "zod";
import { PROCESS_LABELS, type ProcessDetail } from "./process";

/* ============================================================
 * Verze procesů – neměnné snímky procesní karty (pole, kroky, RACI, aktiva, dokumenty),
 * schvalování a porovnání verzí. Živý proces se edituje dál; schválená verze je závazná podoba.
 * ============================================================ */

export const PROCESS_VERSION_STATUSES = ["draft", "approved", "superseded"] as const;
export type ProcessVersionStatus = (typeof PROCESS_VERSION_STATUSES)[number];
export const PROCESS_VERSION_LABELS: Record<ProcessVersionStatus, string> = { draft: "Návrh", approved: "Schváleno", superseded: "Nahrazeno" };

export interface ProcessSnapshotStep {
  order: number;
  name: string;
  stepType: string;
  description: string | null;
  inputs: string | null;
  outputs: string | null;
  duration: string | null;
  systems: string | null;
  raci: string[];
  assets: string[];
}

export interface ProcessSnapshot {
  code: string | null;
  name: string;
  processType: string;
  status: string;
  criticality: string;
  purpose: string | null;
  description: string | null;
  trigger: string | null;
  inputs: string | null;
  outputs: string | null;
  kpis: string | null;
  frequency: string | null;
  legislation: string | null;
  ownerPositionName: string | null;
  orgUnitName: string | null;
  steps: ProcessSnapshotStep[];
  assets: string[];
  documents: string[];
  hasBpmn: boolean;
}

export const ProcessVersionInput = z.object({
  changeSummary: z.string().trim().min(1).max(2000),
});
export type ProcessVersionInput = z.input<typeof ProcessVersionInput>;

export const ApproveProcessVersionInput = z.object({ note: z.string().trim().max(2000).optional() });

export interface ProcessVersionDto {
  id: string;
  processId: string;
  number: number;
  status: ProcessVersionStatus;
  changeSummary: string;
  createdByName: string | null;
  createdAt: string;
  approvedByName: string | null;
  approvedAt: string | null;
  approvalNote: string | null;
  canApprove: boolean;
}

export interface ProcessVersionDetail extends ProcessVersionDto {
  snapshot: ProcessSnapshot;
}

/** Snímek z detailu procesu (bez rizik a údajů o uživatelích). */
export function processSnapshotOf(d: ProcessDetail): ProcessSnapshot {
  return {
    code: d.code,
    name: d.name,
    processType: d.processType,
    status: d.status,
    criticality: d.criticality,
    purpose: d.purpose,
    description: d.description,
    trigger: d.trigger,
    inputs: d.inputs,
    outputs: d.outputs,
    kpis: d.kpis,
    frequency: d.frequency,
    legislation: d.legislation,
    ownerPositionName: d.ownerPositionName,
    orgUnitName: d.orgUnitName,
    steps: [...d.steps]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        order: s.order,
        name: s.name,
        stepType: s.stepType,
        description: s.description,
        inputs: s.inputs,
        outputs: s.outputs,
        duration: s.duration,
        systems: s.systems,
        raci: s.raci.map((r) => `${r.role}: ${r.name}`).sort(),
        assets: s.assets.map((a) => a.name).sort(),
      })),
    assets: d.assets.map((a) => a.name).sort(),
    documents: d.documents.map((x) => x.title).sort(),
    hasBpmn: d.hasBpmn,
  };
}

export interface ProcessDiffItem {
  area: "field" | "step" | "asset" | "document";
  label: string;
  change: "added" | "removed" | "changed";
  from: string | null;
  to: string | null;
}

const FIELD_LABELS: Record<string, string> = {
  code: "Kód",
  name: "Název",
  processType: "Typ",
  status: "Stav",
  criticality: "Kritičnost",
  purpose: "Účel",
  description: "Popis",
  trigger: "Spouštěč",
  inputs: "Vstupy",
  outputs: "Výstupy",
  kpis: "Ukazatele (KPI)",
  frequency: "Četnost",
  legislation: "Legislativa",
  ownerPositionName: "Vlastník (funkční místo)",
  orgUnitName: "Útvar",
  hasBpmn: "BPMN diagram",
};
const STEP_FIELDS: [keyof ProcessSnapshotStep, string][] = [
  ["stepType", "typ"],
  ["description", "popis"],
  ["inputs", "vstupy"],
  ["outputs", "výstupy"],
  ["duration", "doba"],
  ["systems", "systémy"],
];

const show = (k: string, v: unknown): string | null => {
  if (v == null || v === "") return null;
  if (typeof v === "boolean") return v ? "ano" : "ne";
  if (k === "processType") return PROCESS_LABELS.type[v as keyof typeof PROCESS_LABELS.type] ?? String(v);
  if (k === "status") return PROCESS_LABELS.status[v as keyof typeof PROCESS_LABELS.status] ?? String(v);
  return String(v);
};

/** Rozdíly mezi dvěma snímky procesu (a = starší, b = novější). Kroky se párují podle názvu. */
export function diffProcess(a: ProcessSnapshot, b: ProcessSnapshot): ProcessDiffItem[] {
  const out: ProcessDiffItem[] = [];
  for (const k of Object.keys(FIELD_LABELS) as (keyof ProcessSnapshot)[]) {
    const x = show(k, a[k]);
    const y = show(k, b[k]);
    if (x !== y) out.push({ area: "field", label: FIELD_LABELS[k]!, change: x == null ? "added" : y == null ? "removed" : "changed", from: x, to: y });
  }
  const byName = (l: ProcessSnapshotStep[]) => new Map(l.map((s) => [s.name.trim().toLowerCase(), s]));
  const sa = byName(a.steps);
  const sb = byName(b.steps);
  for (const [k, s] of sb) {
    const old = sa.get(k);
    if (!old) {
      out.push({ area: "step", label: `Krok „${s.name}“`, change: "added", from: null, to: `${s.order}. ${s.name}` });
      continue;
    }
    const parts: string[] = [];
    if (old.order !== s.order) parts.push(`pořadí ${old.order} → ${s.order}`);
    for (const [f, l] of STEP_FIELDS) if ((old[f] ?? null) !== (s[f] ?? null)) parts.push(l);
    if (old.raci.join("|") !== s.raci.join("|")) parts.push("RACI");
    if (old.assets.join("|") !== s.assets.join("|")) parts.push("aktiva");
    if (parts.length) out.push({ area: "step", label: `Krok „${s.name}“`, change: "changed", from: null, to: `změněno: ${parts.join(", ")}` });
  }
  for (const [k, s] of sa) if (!sb.has(k)) out.push({ area: "step", label: `Krok „${s.name}“`, change: "removed", from: `${s.order}. ${s.name}`, to: null });
  const setDiff = (area: "asset" | "document", x: string[], y: string[], label: string) => {
    for (const v of y) if (!x.includes(v)) out.push({ area, label: `${label} ${v}`, change: "added", from: null, to: v });
    for (const v of x) if (!y.includes(v)) out.push({ area, label: `${label} ${v}`, change: "removed", from: v, to: null });
  };
  setDiff("asset", a.assets, b.assets, "Aktivum");
  setDiff("document", a.documents, b.documents, "Dokument");
  return out;
}
