import { z } from "zod";

/* ============================================================
 * Kvantitativní analýza rizik – FAIR (Factor Analysis of Information Risk), zjednodušeně:
 *   roční ztráta = Σ ztrát z incidentů v roce; počet incidentů ~ Poisson(λ), λ ~ PERT(min, nejpravděp., max)
 *   (LEF – loss event frequency), ztráta z jednoho incidentu ~ PERT(min, nejpravděp., max) Kč (LM – loss magnitude).
 * Monte Carlo s deterministickým generátorem (stejný vstup = stejný výsledek v API, UI i dokumentu).
 * Kvantitativní výsledek doplňuje kvalitativní úroveň (ta zůstává pro vyhlášku primární).
 * ============================================================ */

export const Range3 = z
  .object({
    min: z.number().min(0),
    mode: z.number().min(0),
    max: z.number().min(0),
  })
  .refine((r) => r.min <= r.mode && r.mode <= r.max, { message: "Musí platit min ≤ nejpravděpodobnější ≤ max" });
export type Range3 = z.infer<typeof Range3>;

export const QuantInput = z.object({
  /** Četnost incidentů za rok (např. 0,1 = jednou za 10 let). */
  lef: Range3,
  /** Ztráta z jednoho incidentu v Kč (přímé i nepřímé náklady: obnova, výpadek, pokuty, reputace). */
  lm: Range3,
  /** Zbytkové riziko po opatřeních (volitelné). */
  residualLef: Range3.nullable().optional(),
  residualLm: Range3.nullable().optional(),
  /** Roční náklady opatření (Kč/rok) – pro návratnost (ROSI); bez vyplnění se použije součet odhadů akcí plánu. */
  controlCostYear: z.number().min(0).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});
export type QuantInput = z.infer<typeof QuantInput>;

/** Pásma očekávané roční ztráty (Kč) pro převod na úrovně CONTIX a ochota nést riziko. */
export const QuantPolicySchema = z.object({
  maxLow: z.number().min(0).default(100_000),
  maxMedium: z.number().min(0).default(1_000_000),
  maxHigh: z.number().min(0).default(10_000_000),
  /** Ochota nést riziko – přijatelná roční ztráta (P95) za celou společnost; null = neurčeno. */
  appetiteYear: z.number().min(0).nullable().default(null),
  /** Počet simulací. */
  iterations: z.number().int().min(1000).max(50_000).default(10_000),
});
export type QuantPolicy = z.infer<typeof QuantPolicySchema>;
export const DEFAULT_QUANT_POLICY: QuantPolicy = QuantPolicySchema.parse({});

export interface QuantStats {
  /** Očekávaná roční ztráta (ALE, průměr simulací). */
  mean: number;
  p10: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  /** Pravděpodobnost alespoň jednoho incidentu za rok. */
  probAny: number;
  /** Křivka překročení ztrát: P(roční ztráta > x). */
  lec: { x: number; p: number }[];
}

export interface QuantResult {
  inherent: QuantStats;
  residual: QuantStats | null;
  /** Úroveň podle pásem očekávané ztráty. */
  level: "low" | "medium" | "high" | "critical";
  residualLevel: "low" | "medium" | "high" | "critical" | null;
  /** Snížení očekávané ztráty opatřeními. */
  reduction: number | null;
  /** Návratnost opatření: (snížení ALE − náklady) / náklady. */
  rosi: number | null;
  controlCostYear: number | null;
}

/* ---------------- generátor a rozdělení ---------------- */

/** Deterministický generátor (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash řetězce pro seed (FNV-1a). */
export function seedOf(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function gamma(shape: number, rand: () => number): number {
  // Marsaglia–Tsang; pro shape < 1 zesílení
  if (shape < 1) return gamma(shape + 1, rand) * Math.pow(rand() || 1e-12, 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      // Box–Muller
      const u1 = rand() || 1e-12;
      const u2 = rand();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rand() || 1e-12;
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}

/** PERT (beta) rozdělení s parametrem λ = 4. */
export function pert(r: Range3, rand: () => number): number {
  if (r.max === r.min) return r.min;
  const a = 1 + (4 * (r.mode - r.min)) / (r.max - r.min);
  const b = 1 + (4 * (r.max - r.mode)) / (r.max - r.min);
  const x = gamma(a, rand);
  const y = gamma(b, rand);
  return r.min + (x / (x + y)) * (r.max - r.min);
}

export const pertMean = (r: Range3) => (r.min + 4 * r.mode + r.max) / 6;

function poisson(lambda: number, rand: () => number): number {
  if (lambda <= 0) return 0;
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand())));
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L);
  return k - 1;
}

/** Simulace ročních ztrát (seřazené vzestupně). */
export function simulateLosses(lef: Range3, lm: Range3, iterations: number, seed: number): Float64Array {
  const rand = rng(seed);
  const out = new Float64Array(iterations);
  for (let i = 0; i < iterations; i++) {
    const n = poisson(pert(lef, rand), rand);
    let loss = 0;
    for (let k = 0; k < n; k++) loss += pert(lm, rand);
    out[i] = loss;
  }
  return out;
}

const pct = (sorted: Float64Array, p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;

export function statsOf(losses: Float64Array, points = 40): QuantStats {
  const s = Float64Array.from(losses).sort();
  const n = s.length;
  let sum = 0;
  let any = 0;
  for (const x of s) {
    sum += x;
    if (x > 0) any++;
  }
  const max = s[n - 1] ?? 0;
  const lec: { x: number; p: number }[] = [];
  if (max > 0) {
    // logaritmická osa od nejmenší nenulové ztráty po maximum (křivka začíná na P(alespoň 1 incident))
    const firstPos = s.find((x) => x > 0) ?? max / 1000;
    const lo = Math.max(1, firstPos * 0.999);
    for (let i = 0; i <= points; i++) {
      const x = lo * Math.pow(max / lo, i / points);
      // počet > x binárním hledáním
      let a = 0;
      let b = n;
      while (a < b) {
        const m = (a + b) >> 1;
        if (s[m]! <= x) a = m + 1;
        else b = m;
      }
      lec.push({ x: Math.round(x), p: (n - a) / n });
    }
  }
  return { mean: sum / n, p10: pct(s, 0.1), p50: pct(s, 0.5), p90: pct(s, 0.9), p95: pct(s, 0.95), p99: pct(s, 0.99), probAny: any / n, lec };
}

export function quantLevel(ale: number, p: QuantPolicy): QuantResult["level"] {
  return ale <= p.maxLow ? "low" : ale <= p.maxMedium ? "medium" : ale <= p.maxHigh ? "high" : "critical";
}

/** Kompletní výpočet pro riziko. `key` (id rizika) určuje seed – výsledek je stabilní. */
export function analyzeQuant(q: QuantInput, policy: QuantPolicy, key: string, actionsCost?: number | null): QuantResult {
  const it = policy.iterations;
  const inh = statsOf(simulateLosses(q.lef, q.lm, it, seedOf(key)));
  const hasRes = !!(q.residualLef || q.residualLm);
  const res = hasRes ? statsOf(simulateLosses(q.residualLef ?? q.lef, q.residualLm ?? q.lm, it, seedOf(`${key}:res`))) : null;
  const cost = q.controlCostYear ?? (actionsCost && actionsCost > 0 ? actionsCost : null);
  const reduction = res ? inh.mean - res.mean : null;
  return {
    inherent: inh,
    residual: res,
    level: quantLevel(inh.mean, policy),
    residualLevel: res ? quantLevel(res.mean, policy) : null,
    reduction,
    rosi: reduction != null && cost ? (reduction - cost) / cost : null,
    controlCostYear: cost,
  };
}

/** Souhrn portfolia: roční ztráty se sčítají po iteracích (stejné seedy jako u jednotlivých rizik). */
export function portfolio(items: { key: string; q: QuantInput }[], policy: QuantPolicy, residual = false): QuantStats | null {
  if (!items.length) return null;
  const total = new Float64Array(policy.iterations);
  for (const { key, q } of items) {
    const l = residual
      ? simulateLosses(q.residualLef ?? q.lef, q.residualLm ?? q.lm, policy.iterations, seedOf(`${key}:res`))
      : simulateLosses(q.lef, q.lm, policy.iterations, seedOf(key));
    for (let i = 0; i < total.length; i++) total[i]! += l[i]!;
  }
  return statsOf(total);
}

export const fmtCzk = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} mil. Kč` : v >= 1000 ? `${Math.round(v / 1000).toLocaleString("cs-CZ")} tis. Kč` : `${Math.round(v).toLocaleString("cs-CZ")} Kč`;
