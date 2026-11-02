import { z } from "zod";
import { RISK_LEVELS, type RiskLevel } from "./risk";
import type { CapabilityKey } from "./riskScenarios";

/* ============================================================
 * Ochota riskovat a klíčové ukazatele rizik – KRI (v1.23, ADR-120).
 * Ochotu schvaluje vedení po kategoriích; KRI se počítají z dat CONTIXu při čtení, persistuje se jen
 * nastavení prahů a okamžik prvního překročení (pro podnět k přehodnocení).
 * ============================================================ */

export const APPETITE_CATEGORIES = ["confidentiality", "integrity", "availability", "suppliers"] as const;
export type AppetiteCategory = (typeof APPETITE_CATEGORIES)[number];

export const AppetiteInput = z.object({
  items: z
    .array(z.object({ key: z.enum(APPETITE_CATEGORIES), maxLevel: z.enum(RISK_LEVELS), statement: z.string().trim().max(2000).nullable().optional() }))
    .min(1)
    .max(APPETITE_CATEGORIES.length),
});
export type AppetiteInput = z.input<typeof AppetiteInput>;

/** Kategorie rizika: složky CIA hrozeb scénáře, dodavatelé = vazba na dodavatele nebo hrozby závislosti / nedodržení smlouvy. */
export function riskCategories(x: { c: boolean; i: boolean; a: boolean; supplier: boolean }): AppetiteCategory[] {
  const out: AppetiteCategory[] = [];
  if (x.c) out.push("confidentiality");
  if (x.i) out.push("integrity");
  if (x.a) out.push("availability");
  if (x.supplier) out.push("suppliers");
  return out;
}

const rank = (l: RiskLevel) => RISK_LEVELS.indexOf(l);

/** Překračuje riziko ochotu? Rozhoduje nejpřísnější kategorie rizika, která má stanovenou ochotu. */
export function appetiteBreach(level: RiskLevel | null, cats: AppetiteCategory[], appetite: Partial<Record<AppetiteCategory, RiskLevel>>): { breached: boolean; limit: RiskLevel | null; categories: AppetiteCategory[] } {
  const limits = cats.filter((c) => appetite[c]).map((c) => ({ c, l: appetite[c]! }));
  if (!level || !limits.length) return { breached: false, limit: null, categories: [] };
  const strictest = limits.reduce((m, x) => (rank(x.l) < rank(m) ? x.l : m), limits[0]!.l);
  return { breached: rank(level) > rank(strictest), limit: strictest, categories: limits.filter((x) => rank(level) > rank(x.l)).map((x) => x.c) };
}

export const KRI_KEYS = ["mfa_coverage", "edr_coverage", "kev_exposed", "vuln_overdue_assets", "restore_untested", "unassessed_threats", "overdue_reassessments"] as const;
export type KriKey = (typeof KRI_KEYS)[number];

export const KRI_META: Record<KriKey, { unit: "pct" | "count"; direction: "min" | "max"; capability: CapabilityKey | null; warn: number; alert: number }> = {
  mfa_coverage: { unit: "pct", direction: "min", capability: "mfa", warn: 95, alert: 90 },
  edr_coverage: { unit: "pct", direction: "min", capability: "edr", warn: 95, alert: 85 },
  kev_exposed: { unit: "count", direction: "max", capability: "vuln_mgmt", warn: 1, alert: 1 },
  vuln_overdue_assets: { unit: "count", direction: "max", capability: "vuln_mgmt", warn: 1, alert: 5 },
  restore_untested: { unit: "count", direction: "max", capability: "backup_recovery", warn: 1, alert: 3 },
  unassessed_threats: { unit: "count", direction: "max", capability: null, warn: 1, alert: 20 },
  overdue_reassessments: { unit: "count", direction: "max", capability: null, warn: 1, alert: 3 },
};

export const KRI_STATUSES = ["ok", "warn", "alert", "unknown"] as const;
export type KriStatus = (typeof KRI_STATUSES)[number];

export function kriStatus(value: number | null, direction: "min" | "max", warn: number, alert: number): KriStatus {
  if (value == null) return "unknown";
  if (direction === "min") return value < alert ? "alert" : value < warn ? "warn" : "ok";
  return value >= alert ? "alert" : value >= warn ? "warn" : "ok";
}

export const KriSettingInput = z
  .object({ enabled: z.boolean(), warn: z.number().min(0).max(100000), alert: z.number().min(0).max(100000) })
  .strict();
export type KriSettingInput = z.input<typeof KriSettingInput>;

export interface KriDto {
  key: KriKey;
  unit: "pct" | "count";
  direction: "min" | "max";
  value: number | null;
  warn: number;
  alert: number;
  enabled: boolean;
  status: KriStatus;
  /** Od kdy je ukazatel v pásmu „alert“ (ISO), jinak null. */
  breachedSince: string | null;
  link: string;
}

export interface RiskAppetiteDto {
  categories: { key: AppetiteCategory; maxLevel: RiskLevel | null; statement: string | null }[];
  approvedByName: string | null;
  approvedAt: string | null;
  /** Ochota byla po schválení změněna (čeká na nové schválení). */
  changedAfterApproval: boolean;
  breaches: { riskId: string; code: string | null; name: string; level: RiskLevel; limit: RiskLevel; categories: AppetiteCategory[]; treatment: string | null }[];
  kris: KriDto[];
}

export const RISK_APPETITE_LABELS = {
  category: { confidentiality: "Důvěrnost", integrity: "Integrita", availability: "Dostupnost", suppliers: "Dodavatelé" } satisfies Record<AppetiteCategory, string>,
  kri: {
    mfa_coverage: "Pokrytí účtů MFA",
    edr_coverage: "Pokrytí koncových bodů EDR",
    kev_exposed: "Aktiva z internetu se zranitelností KEV",
    vuln_overdue_assets: "Aktiva se zranitelnostmi po termínu",
    restore_untested: "Kritické procesy bez otestované obnovy",
    unassessed_threats: "Neposouzené hrozby z katalogu",
    overdue_reassessments: "Rizika s podnětem po termínu rozhodnutí",
  } satisfies Record<KriKey, string>,
  status: { ok: "V normě", warn: "Varování", alert: "Překročeno", unknown: "Bez dat" } satisfies Record<KriStatus, string>,
};
