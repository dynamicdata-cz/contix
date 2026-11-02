import { z } from "zod";
import type { RiskLevel } from "./risk";

/** Úrovně CONTIX (kopie RISK_LEVELS – bez cyklického importu s risk.ts). */
const LEVELS = ["low", "medium", "high", "critical"] as const;

/* ============================================================
 * Metodiky jako data (YAML / JSON / XML).
 *  - risk: faktory se stupnicemi, volitelně oblasti dopadu s vahami (OCTAVE), vzorec skóre,
 *          úrovně (rozsahy skóre nebo pravidla) mapované na úrovně CONTIX (nízké…kritické),
 *          akceptovatelnost, kroky postupu.
 *  - audit: kontrolní seznam (checklist) položek s vazbou na požadavky předpisů.
 * Vestavěná metodika „zkb409“ (příloha č. 4 vyhl. 409/2025) má vlastní výpočet v risk.ts.
 * ============================================================ */

export const BUILTIN_RISK_METHODOLOGY = "zkb409";
export const METHODOLOGY_KINDS = ["risk", "audit"] as const;
export type MethodologyKind = (typeof METHODOLOGY_KINDS)[number];
export const METHODOLOGY_FORMATS = ["yaml", "json", "xml"] as const;
export type MethodologyFormat = (typeof METHODOLOGY_FORMATS)[number];

const key = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{0,39}$/, "klíč: malá písmena, číslice, podtržítko (max. 40)");
const text = z.string().trim().max(5000);

export const ScaleStepDef = z.object({ value: z.number().int().min(0).max(100), label: z.string().trim().min(1).max(100), description: text.optional() });
export const FactorDef = z.object({
  key,
  label: z.string().trim().min(1).max(200),
  description: text.optional(),
  /** true = hodnotí se zvlášť pro každou oblast dopadu (areas). */
  perArea: z.boolean().default(false),
  scale: z.array(ScaleStepDef).min(2).max(20),
});
export const AreaDef = z.object({ key, label: z.string().trim().min(1).max(200), weight: z.number().min(0).max(100), description: text.optional() });
const Range = z.object({ min: z.number().optional(), max: z.number().optional() });
export const LevelDef = z.object({
  key,
  label: z.string().trim().min(1).max(100),
  /** Mapování na úroveň CONTIX (barvy, přehledy, akceptovatelnost v dokumentech). */
  mapsTo: z.enum(LEVELS),
  /** Rozsah skóre (včetně) – použije se, pokud nejsou definována pravidla. */
  min: z.number().optional(),
  max: z.number().optional(),
  acceptable: z.boolean().default(false),
  /** Doporučený přístup ke zvládání (OCTAVE: mitigovat / odložit / akceptovat). */
  treatment: z.string().trim().max(200).optional(),
  description: text.optional(),
});
/** Pravidlo zařazení do úrovně: všechny podmínky (rozsahy proměnných, vč. `score`) musí platit; první shoda vyhrává. */
export const RuleDef = z.object({ level: key, when: z.record(z.string(), Range) });

export const RiskMethodologyDef = z.object({
  kind: z.literal("risk"),
  id: key,
  name: z.string().trim().min(1).max(200),
  version: z.string().trim().max(50).default("1.0"),
  description: text.optional(),
  source: z.string().trim().max(500).optional(),
  factors: z.array(FactorDef).min(1).max(12),
  areas: z.array(AreaDef).max(20).optional(),
  /** Jak sloučit faktor hodnocený po oblastech do jedné proměnné téhož jména. */
  areaAggregate: z.enum(["weighted_sum", "sum", "max", "weighted_max"]).default("weighted_sum"),
  /** Vzorec skóre: + − × / ^, závorky, min, max, round, ceil, floor, sqrt; proměnné = klíče faktorů. */
  formula: z.string().trim().min(1).max(500),
  levels: z.array(LevelDef).min(2).max(10),
  rules: z.array(RuleDef).max(100).optional(),
  /** Osy teplotní mapy (faktory bez oblastí). */
  matrix: z.object({ x: key, y: key }).optional(),
  steps: z.array(z.object({ key, title: z.string().trim().min(1).max(200), description: text.optional() })).max(30).optional(),
});
export type RiskMethodologyDef = z.infer<typeof RiskMethodologyDef>;

export const ChecklistItemDef = z.object({
  id: z.string().trim().min(1).max(60),
  section: z.string().trim().max(100).optional(),
  ref: z.string().trim().max(100).optional(),
  /** Vazba na požadavek v katalogu CONTIX (např. cz409:8/1/c) – pro zjištění a pokrytí. */
  requirementId: z.string().trim().max(100).optional(),
  question: z.string().trim().min(1).max(2000),
  guidance: text.optional(),
});
export const AuditMethodologyDef = z.object({
  kind: z.literal("audit"),
  id: key,
  name: z.string().trim().min(1).max(200),
  version: z.string().trim().max(50).default("1.0"),
  description: text.optional(),
  source: z.string().trim().max(500).optional(),
  checklist: z.array(ChecklistItemDef).min(1).max(2000),
});
export type AuditMethodologyDef = z.infer<typeof AuditMethodologyDef>;

export const MethodologyDef = z.discriminatedUnion("kind", [RiskMethodologyDef, AuditMethodologyDef]);
export type MethodologyDef = z.infer<typeof MethodologyDef>;

export const ImportMethodologyInput = z.object({
  format: z.enum(METHODOLOGY_FORMATS),
  content: z.string().min(1).max(2_000_000),
  /** Přepsat existující vlastní metodiku se stejným id. */
  replace: z.boolean().default(false),
});
export type ImportMethodologyInput = z.input<typeof ImportMethodologyInput>;

export interface MethodologyDto {
  id: string;
  kind: MethodologyKind;
  name: string;
  version: string;
  description: string | null;
  source: string | null;
  builtin: boolean;
  /** Počet použití (společnosti / rizika / audity). */
  usage: number;
  definition: MethodologyDef | null;
  updatedAt: string | null;
}

/* ---------------- bezpečný vyhodnocovač vzorců ---------------- */

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string } | { t: "(" } | { t: ")" } | { t: "," };
const FUNCS: Record<string, (...a: number[]) => number> = {
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  round: (a) => Math.round(a!),
  ceil: (a) => Math.ceil(a!),
  floor: (a) => Math.floor(a!),
  sqrt: (a) => Math.sqrt(a!),
};
const PREC: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 3, "u-": 4 };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      const v = Number(src.slice(i, j));
      if (!Number.isFinite(v)) throw new Error(`neplatné číslo „${src.slice(i, j)}“`);
      out.push({ t: "num", v });
      i = j;
      continue;
    }
    if (/[a-z_]/i.test(ch)) {
      let j = i;
      while (j < src.length && /[a-z0-9_]/i.test(src[j]!)) j++;
      out.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if ("+-*/^".includes(ch)) out.push({ t: "op", v: ch });
    else if (ch === "×") out.push({ t: "op", v: "*" });
    else if (ch === "(") out.push({ t: "(" });
    else if (ch === ")") out.push({ t: ")" });
    else if (ch === ",") out.push({ t: "," });
    else throw new Error(`nepovolený znak „${ch}“`);
    i++;
  }
  return out;
}

type Rpn = ({ t: "num"; v: number } | { t: "var"; v: string } | { t: "op"; v: string } | { t: "fn"; v: string; n: number })[];

/** Převede vzorec na postfix (shunting-yard). Vyhodí chybu u neplatné syntaxe. */
export function compileFormula(src: string): Rpn {
  const toks = tokenize(src);
  const out: Rpn = [];
  const stack: ({ t: "op"; v: string } | { t: "("; fn?: string; n: number })[] = [];
  let prev: Tok | null = null;
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k]!;
    if (tk.t === "num") out.push(tk);
    else if (tk.t === "id") {
      if (toks[k + 1]?.t === "(") {
        if (!FUNCS[tk.v]) throw new Error(`neznámá funkce „${tk.v}“`);
        stack.push({ t: "(", fn: tk.v, n: 1 });
        k++;
      } else out.push({ t: "var", v: tk.v });
    } else if (tk.t === "op") {
      const unary: boolean = tk.v === "-" && (!prev || prev.t === "op" || prev.t === "(" || prev.t === ",");
      const op = unary ? "u-" : tk.v;
      while (stack.length) {
        const top = stack[stack.length - 1]!;
        if (top.t !== "op") break;
        const right = op === "^" || op === "u-";
        if (PREC[top.v]! > PREC[op]! || (PREC[top.v] === PREC[op] && !right)) out.push(stack.pop() as { t: "op"; v: string });
        else break;
      }
      stack.push({ t: "op", v: op });
    } else if (tk.t === "(") stack.push({ t: "(", n: 1 });
    else if (tk.t === "," || tk.t === ")") {
      while (stack.length && stack[stack.length - 1]!.t === "op") out.push(stack.pop() as { t: "op"; v: string });
      const top = stack[stack.length - 1];
      if (!top || top.t !== "(") throw new Error("nespárované závorky");
      if (tk.t === ",") {
        if (!top.fn) throw new Error("čárka mimo funkci");
        top.n++;
      } else {
        stack.pop();
        if (top.fn) out.push({ t: "fn", v: top.fn, n: top.n });
      }
    }
    prev = tk;
  }
  while (stack.length) {
    const top = stack.pop()!;
    if (top.t === "(") throw new Error("nespárované závorky");
    out.push(top);
  }
  // kontrola arity
  let depth = 0;
  for (const x of out) {
    if (x.t === "num" || x.t === "var") depth++;
    else if (x.t === "op") depth += x.v === "u-" ? 0 : -1;
    else depth += 1 - x.n;
    if (depth < 1) throw new Error("neplatný výraz");
  }
  if (depth !== 1) throw new Error("neplatný výraz");
  return out;
}

export function formulaVariables(src: string): string[] {
  return [...new Set(compileFormula(src).filter((x) => x.t === "var").map((x) => (x as { v: string }).v))];
}

export function evalFormula(rpn: Rpn, vars: Record<string, number>): number {
  const st: number[] = [];
  for (const x of rpn) {
    if (x.t === "num") st.push(x.v);
    else if (x.t === "var") {
      const v = vars[x.v];
      if (v === undefined || !Number.isFinite(v)) throw new Error(`chybí hodnota „${x.v}“`);
      st.push(v);
    } else if (x.t === "op") {
      if (x.v === "u-") st.push(-st.pop()!);
      else {
        const b = st.pop()!;
        const a = st.pop()!;
        st.push(x.v === "+" ? a + b : x.v === "-" ? a - b : x.v === "*" ? a * b : x.v === "/" ? (b === 0 ? 0 : a / b) : a ** b);
      }
    } else st.push(FUNCS[x.v]!(...st.splice(st.length - x.n, x.n)));
  }
  return st[0]!;
}

/* ---------------- validace definice ---------------- */

/** Sémantická kontrola nad rámec schématu; vrací seznam chyb (prázdný = v pořádku). */
export function checkMethodology(def: MethodologyDef): string[] {
  const err: string[] = [];
  if (def.kind === "audit") {
    const ids = new Set<string>();
    for (const i of def.checklist) {
      if (ids.has(i.id)) err.push(`Duplicitní položka kontrolního seznamu „${i.id}“.`);
      ids.add(i.id);
    }
    return err;
  }
  const fk = new Set<string>();
  for (const f of def.factors) {
    if (fk.has(f.key)) err.push(`Duplicitní faktor „${f.key}“.`);
    fk.add(f.key);
    const vals = new Set(f.scale.map((s) => s.value));
    if (vals.size !== f.scale.length) err.push(`Faktor „${f.key}“ má duplicitní hodnoty stupnice.`);
    if (f.perArea && !def.areas?.length) err.push(`Faktor „${f.key}“ se hodnotí po oblastech, ale nejsou definovány oblasti (areas).`);
  }
  if (def.factors.filter((f) => f.perArea).length > 1) err.push("Po oblastech lze hodnotit nejvýše jeden faktor.");
  let vars: string[] = [];
  try {
    vars = formulaVariables(def.formula);
  } catch (e) {
    err.push(`Vzorec: ${(e as Error).message}.`);
  }
  for (const v of vars) if (!fk.has(v)) err.push(`Vzorec používá neznámou proměnnou „${v}“.`);
  const lk = new Set(def.levels.map((l) => l.key));
  if (lk.size !== def.levels.length) err.push("Duplicitní klíče úrovní.");
  if (def.rules?.length) {
    for (const r of def.rules) {
      if (!lk.has(r.level)) err.push(`Pravidlo odkazuje na neznámou úroveň „${r.level}“.`);
      for (const k of Object.keys(r.when)) if (k !== "score" && !fk.has(k)) err.push(`Pravidlo používá neznámou proměnnou „${k}“.`);
    }
  } else {
    for (const l of def.levels) if (l.min === undefined && l.max === undefined) err.push(`Úroveň „${l.key}“ nemá rozsah skóre (min/max) a nejsou definována pravidla.`);
  }
  if (!def.levels.some((l) => l.acceptable)) err.push("Žádná úroveň není označena jako akceptovatelná (kritérium akceptovatelnosti rizik).");
  if (def.matrix) for (const a of [def.matrix.x, def.matrix.y]) if (!def.factors.some((f) => f.key === a && !f.perArea)) err.push(`Osa matice „${a}“ musí být faktor bez oblastí.`);
  // simulace: všechny kombinace (omezeně) musí dát úroveň
  if (!err.length) {
    const sample = sampleCombinations(def, 2000);
    for (const v of sample) {
      const r = scoreMethodology(def, v);
      if (r.score != null && !r.level) {
        err.push(`Pro kombinaci ${JSON.stringify(v)} (skóre ${r.score}) nevychází žádná úroveň – doplňte rozsahy nebo pravidla.`);
        break;
      }
    }
  }
  return err;
}

function sampleCombinations(def: RiskMethodologyDef, limit: number): FactorValues[] {
  const out: FactorValues[] = [{}];
  for (const f of def.factors) {
    const next: FactorValues[] = [];
    const values = f.scale.map((s) => s.value);
    for (const base of out) {
      if (f.perArea) {
        // krajní a střední hodnoty pro všechny oblasti stejně (rozumný vzorek)
        for (const v of [values[0]!, values[Math.floor(values.length / 2)]!, values[values.length - 1]!])
          next.push({ ...base, [f.key]: Object.fromEntries((def.areas ?? []).map((a) => [a.key, v])) });
      } else for (const v of values) next.push({ ...base, [f.key]: v });
      if (next.length > limit) break;
    }
    out.splice(0, out.length, ...next.slice(0, limit));
  }
  return out;
}

/* ---------------- výpočet ---------------- */

/** Hodnoty faktorů rizika: číslo, nebo u faktoru po oblastech mapa oblast → hodnota. */
export type FactorValues = Record<string, number | Record<string, number>>;

const rpnCache = new Map<string, Rpn>();

export function scoreMethodology(def: RiskMethodologyDef, values: FactorValues | null | undefined): { score: number | null; level: RiskLevel | null; levelKey: string | null; max: number } {
  const max = maxMethodologyScore(def);
  if (!values) return { score: null, level: null, levelKey: null, max };
  const vars: Record<string, number> = {};
  for (const f of def.factors) {
    const v = values[f.key];
    if (f.perArea) {
      if (!v || typeof v !== "object") return { score: null, level: null, levelKey: null, max };
      const areas = def.areas ?? [];
      if (areas.some((a) => typeof v[a.key] !== "number")) return { score: null, level: null, levelKey: null, max };
      const parts = areas.map((a) => ({ w: a.weight, x: v[a.key]! }));
      vars[f.key] =
        def.areaAggregate === "sum"
          ? parts.reduce((n, p) => n + p.x, 0)
          : def.areaAggregate === "max"
            ? Math.max(...parts.map((p) => p.x))
            : def.areaAggregate === "weighted_max"
              ? Math.max(...parts.map((p) => p.w * p.x))
              : parts.reduce((n, p) => n + p.w * p.x, 0);
    } else {
      if (typeof v !== "number") return { score: null, level: null, levelKey: null, max };
      vars[f.key] = v;
    }
  }
  let rpn = rpnCache.get(def.formula);
  if (!rpn) {
    rpn = compileFormula(def.formula);
    rpnCache.set(def.formula, rpn);
  }
  const score = Math.round(evalFormula(rpn, vars) * 100) / 100;
  const lv = classify(def, { ...vars, score });
  return { score, level: lv?.mapsTo ?? null, levelKey: lv?.key ?? null, max };
}

/**
 * Teplotní mapa maticové metodiky (`matrix: { x, y }`, ADR-083): osy = stupnice faktorů, úroveň buňky = výsledek metodiky
 * pro dané hodnoty os (jen když vzorec a pravidla nezávisí na jiném faktoru – jinak null = neutrální barva).
 */
export function methodologyMatrix(def: RiskMethodologyDef | null | undefined) {
  if (!def?.matrix) return null;
  const x = def.factors.find((f) => f.key === def.matrix!.x && !f.perArea);
  const y = def.factors.find((f) => f.key === def.matrix!.y && !f.perArea);
  if (!x || !y) return null;
  const onlyAxes = def.factors.every((f) => f.key === x.key || f.key === y.key);
  const levelAt = (xv: number, yv: number): RiskLevel | null => (onlyAxes ? scoreMethodology(def, { [x.key]: xv, [y.key]: yv }).level : null);
  /** Pozice rizika v matici [index y][index x] podle hodnot faktorů. */
  const cellOf = (values: FactorValues | null | undefined): [number, number] | null => {
    const xv = values?.[x.key];
    const yv = values?.[y.key];
    if (typeof xv !== "number" || typeof yv !== "number") return null;
    const xi = x.scale.findIndex((s) => s.value === xv);
    const yi = y.scale.findIndex((s) => s.value === yv);
    return xi < 0 || yi < 0 ? null : [yi, xi];
  };
  return { x, y, levelAt, cellOf };
}

function classify(def: RiskMethodologyDef, vars: Record<string, number>) {
  const inRange = (x: number, r: { min?: number; max?: number }) => (r.min === undefined || x >= r.min) && (r.max === undefined || x <= r.max);
  if (def.rules?.length) {
    for (const r of def.rules) if (Object.entries(r.when).every(([k, rg]) => vars[k] !== undefined && inRange(vars[k]!, rg))) return def.levels.find((l) => l.key === r.level) ?? null;
    return null;
  }
  return def.levels.find((l) => inRange(vars.score!, l)) ?? null;
}

/** Kontrola hodnot faktorů proti stupnicím a oblastem metodiky (neúplné hodnocení je dovoleno). */
export function factorErrors(def: RiskMethodologyDef, values: FactorValues | null | undefined): string[] {
  if (!values) return [];
  const errs: string[] = [];
  const fk = new Map(def.factors.map((f) => [f.key, f]));
  const areas = new Set((def.areas ?? []).map((a) => a.key));
  for (const [k, v] of Object.entries(values)) {
    const f = fk.get(k);
    if (!f) {
      errs.push(`Neznámý faktor „${k}“.`);
      continue;
    }
    const ok = new Set(f.scale.map((x) => x.value));
    if (f.perArea) {
      if (typeof v !== "object") {
        errs.push(`Faktor „${k}“ se hodnotí po oblastech.`);
        continue;
      }
      for (const [a, x] of Object.entries(v)) {
        if (!areas.has(a)) errs.push(`Neznámá oblast „${a}“ u faktoru „${k}“.`);
        else if (!ok.has(x)) errs.push(`Hodnota ${x} není na stupnici faktoru „${k}“.`);
      }
    } else if (typeof v !== "number" || !ok.has(v)) errs.push(`Hodnota faktoru „${k}“ není na stupnici.`);
  }
  return errs;
}

/** Maximální skóre (pro zobrazení) – vzorec vyhodnocený s maximy stupnic. */
export function maxMethodologyScore(def: RiskMethodologyDef): number {
  try {
    const top: FactorValues = {};
    for (const f of def.factors) {
      const m = Math.max(...f.scale.map((s) => s.value));
      top[f.key] = f.perArea ? Object.fromEntries((def.areas ?? []).map((a) => [a.key, m])) : m;
    }
    const vars: Record<string, number> = {};
    for (const f of def.factors) {
      const v = top[f.key]!;
      if (typeof v === "number") vars[f.key] = v;
      else {
        const parts = (def.areas ?? []).map((a) => ({ w: a.weight, x: v[a.key]! }));
        vars[f.key] =
          def.areaAggregate === "sum" ? parts.reduce((n, p) => n + p.x, 0) : def.areaAggregate === "max" ? Math.max(...parts.map((p) => p.x)) : def.areaAggregate === "weighted_max" ? Math.max(...parts.map((p) => p.w * p.x)) : parts.reduce((n, p) => n + p.w * p.x, 0);
      }
    }
    return Math.round(evalFormula(compileFormula(def.formula), vars) * 100) / 100;
  } catch {
    return 0;
  }
}

/* ---------------- registr metodik (načtené definice) ---------------- */

const registry = new Map<string, MethodologyDef>();
export function registerMethodologies(defs: MethodologyDef[]) {
  for (const d of defs) registry.set(d.id, d);
}
export function unregisterMethodology(id: string) {
  if (!BUILTIN_METHODOLOGIES.some((b) => b.id === id)) registry.delete(id);
}
/** Dynamické metodiky (kontrolní seznam auditu z libovolného rámce knihovny „fw:<rámec>“ – ADR-080). */
let dynamicResolver: ((id: string) => MethodologyDef | null) | null = null;
export function setMethodologyResolver(fn: (id: string) => MethodologyDef | null) {
  dynamicResolver = fn;
}
export function getMethodology(id: string | null | undefined): MethodologyDef | null {
  if (!id) return null;
  return registry.get(id) ?? dynamicResolver?.(id) ?? null;
}
export function getRiskMethodology(id: string | null | undefined): RiskMethodologyDef | null {
  const d = getMethodology(id);
  return d?.kind === "risk" ? d : null;
}

/* ---------------- vestavěné metodiky ---------------- */

/**
 * OCTAVE Allegro (CERT/SEI, 2007) – relativní skóre rizika = Σ (váha oblasti × dopad v oblasti),
 * oblasti seřazené podle priority organizace (5 = nejdůležitější); pravděpodobnost a „pooly“ zvládání
 * dle relativní matice rizik. Váhy oblastí a hranice poolů si organizace upraví exportem a importem YAML.
 */
export const OCTAVE_ALLEGRO: RiskMethodologyDef = {
  kind: "risk",
  id: "octave_allegro",
  name: "OCTAVE Allegro",
  version: "1.0",
  description:
    "Hodnocení rizik informačních aktiv podle OCTAVE Allegro: kritéria měření rizik s prioritizovanými oblastmi dopadu, profil aktiva a jeho kontejnery, oblasti zájmu a scénáře hrozeb, relativní skóre rizika a volba přístupu (pool) ke zvládání.",
  source: "Caralli, Stevens, Young, Wilson: Introducing OCTAVE Allegro, CMU/SEI-2007-TR-012",
  factors: [
    {
      key: "impact",
      label: "Dopad v oblasti",
      perArea: true,
      scale: [
        { value: 1, label: "Nízký" },
        { value: 2, label: "Střední" },
        { value: 3, label: "Vysoký" },
      ],
    },
    {
      key: "probability",
      label: "Pravděpodobnost",
      perArea: false,
      scale: [
        { value: 1, label: "Nízká" },
        { value: 2, label: "Střední" },
        { value: 3, label: "Vysoká" },
      ],
    },
  ],
  areas: [
    { key: "reputation", label: "Pověst a důvěra zákazníků", weight: 5 },
    { key: "financial", label: "Finance", weight: 4 },
    { key: "productivity", label: "Produktivita", weight: 3 },
    { key: "safety", label: "Bezpečnost a zdraví", weight: 2 },
    { key: "fines", label: "Pokuty a právní sankce", weight: 1 },
  ],
  areaAggregate: "weighted_sum",
  formula: "impact",
  levels: [
    { key: "pool1", label: "Pool 1 – zmírnit", mapsTo: "critical", acceptable: false, treatment: "Mitigovat" },
    { key: "pool2", label: "Pool 2 – zmírnit nebo odložit", mapsTo: "high", acceptable: false, treatment: "Mitigovat nebo odložit" },
    { key: "pool3", label: "Pool 3 – odložit nebo akceptovat", mapsTo: "medium", acceptable: false, treatment: "Odložit nebo akceptovat" },
    { key: "pool4", label: "Pool 4 – akceptovat", mapsTo: "low", acceptable: true, treatment: "Akceptovat" },
  ],
  // výchozí relativní matice rizik (skóre 0–15 / 16–29 / 30–45 × pravděpodobnost) – organizace si ji upraví
  rules: [
    { level: "pool1", when: { probability: { min: 3 }, score: { min: 30 } } },
    { level: "pool2", when: { probability: { min: 3 }, score: { min: 16 } } },
    { level: "pool2", when: { probability: { min: 2, max: 2 }, score: { min: 16 } } },
    { level: "pool2", when: { probability: { max: 1 }, score: { min: 30 } } },
    { level: "pool3", when: { probability: { min: 2 } } },
    { level: "pool3", when: { probability: { max: 1 }, score: { min: 16 } } },
    { level: "pool4", when: { probability: { max: 1 } } },
  ],
  steps: [
    { key: "step1", title: "Stanovení kritérií měření rizik", description: "Oblasti dopadu, jejich priorita (váha) a definice nízkého, středního a vysokého dopadu v každé oblasti." },
    { key: "step2", title: "Profil informačního aktiva", description: "Popis aktiva, vlastník, požadavky na důvěrnost, integritu a dostupnost, nejdůležitější požadavek." },
    { key: "step3", title: "Kontejnery informačního aktiva", description: "Technické, fyzické a lidské kontejnery, kde je aktivum uloženo, přenášeno a zpracováváno (vnitřní i vnější)." },
    { key: "step4", title: "Oblasti zájmu", description: "Situace, které mohou ohrozit aktivum v jeho kontejnerech." },
    { key: "step5", title: "Scénáře hrozeb", description: "Aktér, prostředek, motiv, výsledek, bezpečnostní požadavky; stromy hrozeb." },
    { key: "step6", title: "Identifikace rizik", description: "Důsledky scénáře v jednotlivých oblastech dopadu." },
    { key: "step7", title: "Analýza rizik", description: "Hodnocení dopadu v každé oblasti a výpočet relativního skóre rizika." },
    { key: "step8", title: "Volba přístupu ke zvládání", description: "Zařazení do poolu podle relativního skóre a pravděpodobnosti; mitigace, odložení nebo akceptace." },
  ],
};

/** Ukázková vlastní metodika ve stylu ISO/IEC 27005: dopad × pravděpodobnost 5 × 5 s rozsahy skóre. */
export const ISO27005_5X5: RiskMethodologyDef = {
  kind: "risk",
  id: "matrix_5x5",
  name: "Matice dopad × pravděpodobnost 5 × 5",
  version: "1.0",
  description: "Jednoduchá matice podle principů ISO/IEC 27005 – vzor pro vlastní metodiku (export jako YAML, úprava, import).",
  source: "CONTIX – vzor",
  factors: [
    {
      key: "impact",
      label: "Dopad",
      perArea: false,
      scale: [
        { value: 1, label: "Zanedbatelný" },
        { value: 2, label: "Malý" },
        { value: 3, label: "Střední" },
        { value: 4, label: "Velký" },
        { value: 5, label: "Kritický" },
      ],
    },
    {
      key: "likelihood",
      label: "Pravděpodobnost",
      perArea: false,
      scale: [
        { value: 1, label: "Velmi nízká" },
        { value: 2, label: "Nízká" },
        { value: 3, label: "Střední" },
        { value: 4, label: "Vysoká" },
        { value: 5, label: "Téměř jistá" },
      ],
    },
  ],
  areaAggregate: "weighted_sum",
  formula: "impact * likelihood",
  levels: [
    { key: "low", label: "Nízké", mapsTo: "low", min: 1, max: 4, acceptable: true },
    { key: "medium", label: "Střední", mapsTo: "medium", min: 5, max: 9, acceptable: false },
    { key: "high", label: "Vysoké", mapsTo: "high", min: 10, max: 16, acceptable: false },
    { key: "critical", label: "Kritické", mapsTo: "critical", min: 17, max: 25, acceptable: false },
  ],
  matrix: { x: "likelihood", y: "impact" },
};

export const BUILTIN_METHODOLOGIES: MethodologyDef[] = [OCTAVE_ALLEGRO, ISO27005_5X5];
registerMethodologies(BUILTIN_METHODOLOGIES);

/** Popis vestavěné metodiky dle vyhlášky (výpočet v risk.ts – nastavuje se v Administraci). */
export const ZKB409_INFO = {
  id: BUILTIN_RISK_METHODOLOGY,
  kind: "risk" as const,
  name: "Vyhláška č. 409/2025 Sb., příloha č. 4",
  version: "2025",
  description: "Riziko = hodnota aktiva × hrozba × zranitelnost (nebo dopad × pravděpodobnost scénáře), stupnice 3–5 úrovní, kritérium akceptovatelnosti dle § 8.",
  source: "vyhl. č. 409/2025 Sb.",
};
