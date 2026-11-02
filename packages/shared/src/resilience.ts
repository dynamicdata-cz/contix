import type { Criticality } from "./asset";

/* ============================================================
 * Analýza odolnosti (v0.70, ADR-065): požadavky z BIA (RTO / RPO procesů) se přenesou po grafu
 * závislostí (proces → aktivum → podpůrná aktiva a technické závislosti) na všechna aktiva, na kterých
 * proces závisí. Nálezy: jednotlivé body selhání (SPOF), nižší kritičnost než závislá aktiva, chybějící
 * nebo nedostatečný plán kontinuity, kritická závislost ve špatném stavu, BIA bez aktiv.
 * Počítá se při čtení, nic se nepersistuje.
 * ============================================================ */

export const CRIT_RANK: Record<Criticality, number> = { low: 1, medium: 2, high: 3, critical: 4 };
export const RANK_CRIT: Criticality[] = ["low", "low", "medium", "high", "critical"];

/** RTO, od kterého je nekryté / neredundantní aktivum nálezem (h). */
export const RESILIENCE_SPOF_RTO = 24;
export const RESILIENCE_PLAN_RTO = 72;

export interface ResilienceNode {
  id: string;
  kind: "asset" | "process";
  name: string;
  criticality: Criticality | null;
  redundant: boolean;
  /** Stav (semafor) a zranitelnosti P1 – u aktiv. */
  health: string | null;
  p1: number;
}
export interface ResilienceInput {
  nodes: ResilienceNode[];
  /** Zdroj závisí na cíli. */
  edges: { from: string; to: string }[];
  /** BIA procesů. */
  bia: Map<string, { rtoHours: number | null; rpoHours: number | null }>;
  /** Plány kontinuity: aktivum → nejlepší (nejnižší) cílové RTO plánu; null = plán bez RTO. */
  plans: Map<string, number | null>;
}

export interface AssetRequirement {
  assetId: string;
  name: string;
  rtoHours: number | null;
  rpoHours: number | null;
  /** Procesy s BIA, které na aktivu (tranzitivně) závisí. */
  processes: { id: string; name: string; rtoHours: number | null }[];
  /** Nejvyšší kritičnost aktiv, která na něm závisí. */
  requiredCriticality: Criticality | null;
  /** Kolik uzlů na aktivu (tranzitivně) závisí. */
  dependents: number;
}

export const RESILIENCE_KINDS = ["spof", "criticality_gap", "no_plan", "plan_rto", "unhealthy", "bia_no_assets"] as const;
export type ResilienceKind = (typeof RESILIENCE_KINDS)[number];
export type ResilienceSeverity = "critical" | "high" | "medium";

export interface ResilienceFinding {
  kind: ResilienceKind;
  severity: ResilienceSeverity;
  nodeId: string;
  name: string;
  rtoHours: number | null;
  /** Doplňující hodnoty pro text (kritičnost, plán RTO, počet závislých…). */
  detail: Record<string, string | number | null>;
}

export interface ResilienceDto {
  requirements: AssetRequirement[];
  findings: ResilienceFinding[];
  summary: { assets: number; withRequirement: number; spof: number; byKind: Record<ResilienceKind, number> };
}

const sevOfRto = (rto: number | null): ResilienceSeverity => (rto != null && rto <= 4 ? "critical" : rto != null && rto <= RESILIENCE_SPOF_RTO ? "high" : "medium");
const minN = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.min(a, b));

/** Požadavky a nálezy. */
export function analyzeResilience(input: ResilienceInput): ResilienceDto {
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const out = new Map<string, string[]>();
  for (const e of input.edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const reqs = new Map<string, AssetRequirement>();
  const req = (id: string) => {
    let r = reqs.get(id);
    if (!r) reqs.set(id, (r = { assetId: id, name: byId.get(id)?.name ?? id, rtoHours: null, rpoHours: null, processes: [], requiredCriticality: null, dependents: 0 }));
    return r;
  };
  // každý uzel předá své požadavky všemu, na čem (tranzitivně) závisí
  for (const src of input.nodes) {
    const seen = new Set<string>();
    const q = [...(out.get(src.id) ?? [])];
    const bia = src.kind === "process" ? input.bia.get(src.id) : undefined;
    while (q.length) {
      const id = q.shift()!;
      if (seen.has(id) || id === src.id) continue;
      seen.add(id);
      q.push(...(out.get(id) ?? []));
      const n = byId.get(id);
      if (!n || n.kind !== "asset") continue;
      const r = req(id);
      r.dependents++;
      if (bia) {
        r.rtoHours = minN(r.rtoHours, bia.rtoHours);
        r.rpoHours = minN(r.rpoHours, bia.rpoHours);
        r.processes.push({ id: src.id, name: src.name, rtoHours: bia.rtoHours });
      }
      if (src.kind === "asset" && src.criticality && (!r.requiredCriticality || CRIT_RANK[src.criticality] > CRIT_RANK[r.requiredCriticality])) r.requiredCriticality = src.criticality;
    }
  }
  const findings: ResilienceFinding[] = [];
  const add = (f: ResilienceFinding) => findings.push(f);
  for (const n of input.nodes) {
    if (n.kind === "process") {
      const b = input.bia.get(n.id);
      if (b?.rtoHours != null && !(out.get(n.id) ?? []).length) add({ kind: "bia_no_assets", severity: sevOfRto(b.rtoHours), nodeId: n.id, name: n.name, rtoHours: b.rtoHours, detail: {} });
      continue;
    }
    const r = reqs.get(n.id);
    if (!r) continue;
    const rto = r.rtoHours;
    const critical = rto != null && rto <= RESILIENCE_SPOF_RTO;
    if (!n.redundant && (critical || (r.dependents >= 3 && r.requiredCriticality && CRIT_RANK[r.requiredCriticality] >= 3)))
      add({ kind: "spof", severity: critical ? sevOfRto(rto) : "medium", nodeId: n.id, name: n.name, rtoHours: rto, detail: { dependents: r.dependents, processes: r.processes.length } });
    if (n.criticality && r.requiredCriticality && CRIT_RANK[n.criticality] < CRIT_RANK[r.requiredCriticality])
      add({ kind: "criticality_gap", severity: CRIT_RANK[r.requiredCriticality] - CRIT_RANK[n.criticality] >= 2 ? "high" : "medium", nodeId: n.id, name: n.name, rtoHours: rto, detail: { own: n.criticality, required: r.requiredCriticality } });
    if (rto != null && rto <= RESILIENCE_PLAN_RTO) {
      if (!input.plans.has(n.id)) add({ kind: "no_plan", severity: rto <= RESILIENCE_SPOF_RTO ? "high" : "medium", nodeId: n.id, name: n.name, rtoHours: rto, detail: {} });
      else {
        const target = input.plans.get(n.id)!;
        if (target != null && target > rto) add({ kind: "plan_rto", severity: sevOfRto(rto), nodeId: n.id, name: n.name, rtoHours: rto, detail: { planRto: target } });
      }
    }
    if (critical && (n.health === "red" || n.p1 > 0)) add({ kind: "unhealthy", severity: sevOfRto(rto), nodeId: n.id, name: n.name, rtoHours: rto, detail: { health: n.health, p1: n.p1 } });
  }
  const rank: Record<ResilienceSeverity, number> = { critical: 0, high: 1, medium: 2 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.rtoHours ?? 1e9) - (b.rtoHours ?? 1e9) || a.name.localeCompare(b.name));
  const byKind = Object.fromEntries(RESILIENCE_KINDS.map((k) => [k, findings.filter((f) => f.kind === k).length])) as Record<ResilienceKind, number>;
  const requirements = [...reqs.values()].filter((r) => r.rtoHours != null || r.requiredCriticality).sort((a, b) => (a.rtoHours ?? 1e9) - (b.rtoHours ?? 1e9));
  return { requirements, findings, summary: { assets: input.nodes.filter((n) => n.kind === "asset").length, withRequirement: requirements.filter((r) => r.rtoHours != null).length, spof: byKind.spof, byKind } };
}

export const RESILIENCE_LABELS = {
  kind: {
    spof: "Jediný bod selhání",
    criticality_gap: "Nižší kritičnost než závislá aktiva",
    no_plan: "Bez plánu kontinuity",
    plan_rto: "Plán nesplní požadované RTO",
    unhealthy: "Kritická závislost ve špatném stavu",
    bia_no_assets: "BIA procesu bez navázaných aktiv",
  } as Record<ResilienceKind, string>,
  severity: { critical: "Kritický", high: "Vysoký", medium: "Střední" } as Record<ResilienceSeverity, string>,
};
