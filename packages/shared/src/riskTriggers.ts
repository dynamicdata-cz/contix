import { z } from "zod";
import type { RiskPolicy } from "./risk";

/* ============================================================
 * Podněty k přehodnocení rizika (v0.63, ADR-058): co se od posledního hodnocení
 * stalo na riziku nebo jeho aktivech – incidenty, zjištění auditů, významné změny,
 * signály SOC, zranitelnosti P1/KEV, neúčinné testy opatření, prošlé výjimky
 * a dotazníky dodavatelů; od v1.18 i změna doložených skutečností přijatého scénáře z dat (ADR-115). Počítá se při čtení; nic se nemění automaticky –
 * rozhoduje vlastník rizika (změna hodnocení nebo potvrzení beze změny se zdůvodněním).
 * ============================================================ */

export const RISK_TRIGGER_KINDS = ["incident", "audit_finding", "change", "soc", "vuln", "control_test", "exception", "supplier", "scenario", "control_monitor", "kri"] as const;
export type RiskTriggerKind = (typeof RISK_TRIGGER_KINDS)[number];

export interface RiskTrigger {
  kind: RiskTriggerKind;
  /** Kdy podnět nastal (ISO). */
  at: string;
  /** Odkaz v aplikaci (např. /incidents/…), pokud existuje. */
  link: string | null;
  title: string;
  /** Doplňující údaj (závažnost, výsledek, počet…). */
  detail: string | null;
  /** Souhrnné podněty (SOC, zranitelnosti) – počet položek. */
  count: number;
  /** Silnější podnět (významný incident, závažné zjištění, P1/KEV, pokus o zneužití). */
  strong: boolean;
}

/** Lhůta na rozhodnutí vlastníka rizika od prvního podnětu (dny). */
export const RISK_TRIGGER_DUE_DAYS = 30;

export const RISK_REVIEW_DECISIONS = ["confirmed", "changed"] as const;
export type RiskReviewDecision = (typeof RISK_REVIEW_DECISIONS)[number];

export interface RiskReviewDto {
  id: string;
  decision: RiskReviewDecision;
  note: string | null;
  triggers: RiskTrigger[];
  levelBefore: string | null;
  levelAfter: string | null;
  scoreBefore: number | null;
  scoreAfter: number | null;
  userName: string | null;
  createdAt: string;
}

export interface RiskSuggestionChange {
  field: "threatLevel" | "vulnLevel" | "likelihood";
  from: number;
  to: number;
  kinds: RiskTriggerKind[];
}

export interface RiskReassessmentDto {
  /** Od kdy se podněty počítají (poslední hodnocení nebo potvrzení). */
  baseline: string | null;
  triggers: RiskTrigger[];
  /** Termín rozhodnutí (první podnět + 30 dní). */
  due: string | null;
  /** Návrh nových hodnot – jen do formuláře, nic se neuloží samo. */
  suggestion: RiskSuggestionChange[];
  reviews: RiskReviewDto[];
}

export const RiskReviewInput = z.object({
  /** Zdůvodnění, proč hodnocení zůstává beze změny (§ 8 – doložitelné rozhodnutí). */
  note: z.string().trim().min(5).max(5000),
});
export type RiskReviewInput = z.input<typeof RiskReviewInput>;

/** Druhy podnětů, které zvyšují hrozbu (pravděpodobnost) resp. zranitelnost. */
const THREAT_KINDS: RiskTriggerKind[] = ["incident", "soc"];
const VULN_KINDS: RiskTriggerKind[] = ["vuln", "audit_finding", "control_test", "exception", "control_monitor"];

/**
 * Deterministický návrh: podnět na straně hrozby → úroveň hrozby +1, na straně zranitelnosti → úroveň zranitelnosti +1
 * (u dvoufaktorové metody obojí → pravděpodobnost +1). Jen silné podněty nebo alespoň dva podněty stejné strany.
 * Strop = počet úrovní stupnice. Změny a dodavatelé se jen zobrazí – jejich dopad posoudí vlastník.
 */
export function suggestFromTriggers(
  r: { threatLevel: number | null; vulnLevel: number | null; likelihood: number | null; scaleLevels: number },
  triggers: RiskTrigger[],
  method: RiskPolicy["method"],
): RiskSuggestionChange[] {
  const side = (kinds: RiskTriggerKind[]) => {
    const hit = triggers.filter((t) => kinds.includes(t.kind));
    return hit.some((t) => t.strong) || hit.length >= 2 ? [...new Set(hit.map((t) => t.kind))] : [];
  };
  const out: RiskSuggestionChange[] = [];
  const bump = (field: RiskSuggestionChange["field"], cur: number | null, kinds: RiskTriggerKind[]) => {
    if (!kinds.length || cur == null || cur >= r.scaleLevels) return;
    out.push({ field, from: cur, to: cur + 1, kinds });
  };
  const th = side(THREAT_KINDS);
  const vu = side(VULN_KINDS);
  if (method === "two_factor") bump("likelihood", r.likelihood, [...new Set([...th, ...vu])]);
  else {
    bump("threatLevel", r.threatLevel, th);
    bump("vulnLevel", r.vulnLevel, vu);
  }
  return out;
}

/** Termín rozhodnutí: nejstarší podnět + 30 dní. */
export function triggerDue(triggers: RiskTrigger[]): string | null {
  if (!triggers.length) return null;
  const first = triggers.reduce((m, t) => (t.at < m ? t.at : m), triggers[0]!.at);
  const d = new Date(first);
  d.setUTCDate(d.getUTCDate() + RISK_TRIGGER_DUE_DAYS);
  return d.toISOString().slice(0, 10);
}

export const RISK_TRIGGER_LABELS = {
  kind: {
    incident: "Incident",
    audit_finding: "Zjištění auditu",
    change: "Významná změna",
    soc: "Signály SOC",
    vuln: "Zranitelnosti P1 / KEV",
    control_test: "Neúčinný test opatření",
    exception: "Prošlá výjimka",
    supplier: "Dotazník dodavatele",
    scenario: "Změna dat scénáře",
    control_monitor: "Nesplněný monitor opatření",
    kri: "Překročený ukazatel KRI",
  } as Record<RiskTriggerKind, string>,
  decision: { confirmed: "Potvrzeno beze změny", changed: "Hodnocení změněno" } as Record<RiskReviewDecision, string>,
  field: { threatLevel: "Úroveň hrozby", vulnLevel: "Úroveň zranitelnosti", likelihood: "Pravděpodobnost" } as Record<RiskSuggestionChange["field"], string>,
};
