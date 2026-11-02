import { z } from "zod";
import { BUILTIN_RISK_METHODOLOGY, getRiskMethodology, scoreMethodology, type FactorValues } from "./methodology";
import { patchOf } from "./zutil";
import { DEFAULT_QUANT_POLICY, QuantInput, QuantPolicySchema, type QuantResult } from "./quant";

/* ============================================================
 * Rizika – metodika dle zákona č. 264/2025 Sb. a vyhlášky č. 409/2025 Sb. (příloha č. 4),
 * katalog hrozeb a zranitelností dle přílohy č. 3, registr a hodnocení.
 *
 * Příloha č. 4:
 *  (3) Riziko = hodnota aktiva × hrozba × zranitelnost (případně jiná funkce obdobného významu),
 *  (4) hodnota aktiva vychází z hodnocení aktiv dle přílohy č. 1 (důvěrnost, integrita, dostupnost; 4 úrovně),
 *  (5) lze použít jiný počet úrovní nebo sloučit hrozbu a zranitelnost (scénář / pravděpodobnost),
 *      pokud zůstane zřetelně vyjádřena úroveň hrozby i zranitelnosti (např. komentářem).
 * CONTIX proto podporuje stupnice 3, 4 (výchozí = vyhláška) a 5 úrovní s převodní tabulkou na úrovně vyhlášky
 * a u dvoufaktorové metody vede úroveň hrozby a zranitelnosti jako doplňující údaje.
 * ============================================================ */

export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const RISK_STATUSES = ["identified", "assessed", "treatment", "accepted", "closed"] as const;
export const RiskStatus = z.enum(RISK_STATUSES);
export type RiskStatus = z.infer<typeof RiskStatus>;

/** Metody zvládání rizik – příloha č. 4 odst. 6 vyhlášky č. 409/2025 Sb. */
export const TREATMENTS = ["mitigate", "accept", "eliminate", "avoid", "transfer"] as const;
export const Treatment = z.enum(TREATMENTS);
export type Treatment = z.infer<typeof Treatment>;

export const SCALE_LEVELS = [3, 4, 5] as const;
export type ScaleLevels = (typeof SCALE_LEVELS)[number];

/** Úrovně vyhlášky (1 = nízká … 4 = kritická). */
export const DECREE_LEVEL_NAMES = ["", "Nízká", "Střední", "Vysoká", "Kritická"] as const;

export const RISK_LABELS = {
  level: { low: "Nízké", medium: "Střední", high: "Vysoké", critical: "Kritické" } satisfies Record<RiskLevel, string>,
  /** Příloha č. 4 tab. č. 3 vyhlášky č. 409/2025 Sb. */
  levelDesc: {
    low: "Riziko je považováno za akceptovatelné.",
    medium: "Riziko může být sníženo méně náročnými bezpečnostními opatřeními nebo v případě vyšší náročnosti bezpečnostních opatření je riziko akceptovatelné.",
    high: "Riziko je dlouhodobě nepřípustné a musí být zahájeny systematické kroky k jeho odstranění.",
    critical: "Riziko je nepřípustné a musí být neprodleně zahájeny kroky k jeho odstranění.",
  } satisfies Record<RiskLevel, string>,
  status: {
    identified: "Identifikované",
    assessed: "Ohodnocené",
    treatment: "V řešení",
    accepted: "Akceptované",
    closed: "Uzavřené",
  } satisfies Record<RiskStatus, string>,
  treatment: {
    mitigate: "Redukce rizika (opatření)",
    accept: "Akceptace rizika",
    eliminate: "Eliminace rizika",
    avoid: "Vyhnutí se riziku",
    transfer: "Přenesení nebo sdílení rizika",
  } satisfies Record<Treatment, string>,
} as const;

export interface ScaleStep {
  value: number;
  name: string;
  description: string;
  /** Odpovídající úroveň(ně) vyhlášky (1–4) – zřetelná vazba dle přílohy č. 4 odst. 5. */
  decree: number[];
}
export type ScaleKind = "impact" | "threat" | "vulnerability" | "likelihood";

/** Tab. č. 1 přílohy č. 4 – stupnice pro hodnocení hrozeb (4 úrovně). */
const THREAT4 = [
  "Hrozba neexistuje nebo je málo pravděpodobná. Předpokládaná realizace hrozby není častější než jednou za 5 let.",
  "Hrozba je málo pravděpodobná až pravděpodobná. Předpokládaná realizace hrozby je v rozpětí od 1 roku do 5 let.",
  "Hrozba je pravděpodobná až velmi pravděpodobná. Předpokládaná realizace hrozby je v rozpětí od 1 měsíce do 1 roku.",
  "Hrozba je velmi pravděpodobná až víceméně jistá. Předpokládaná realizace hrozby je častější než jednou za měsíc.",
];
/** Tab. č. 2 přílohy č. 4 – stupnice pro hodnocení zranitelností (4 úrovně). */
const VULN4 = [
  "Zranitelnost neexistuje nebo je zneužití zranitelnosti málo pravděpodobné. Jsou zavedena bezpečnostní opatření, která jsou schopna včas detekovat možné zranitelnosti nebo případné pokusy o jejich zneužití.",
  "Zneužití zranitelnosti je málo pravděpodobné až pravděpodobné. Jsou zavedena bezpečnostní opatření, jejichž účinnost je pravidelně kontrolována. Schopnost bezpečnostních opatření včas detekovat možné zranitelnosti nebo případné pokusy o překonání bezpečnostních opatření je omezena. Nejsou známé žádné úspěšné pokusy o překonání bezpečnostních opatření.",
  "Zneužití zranitelnosti je pravděpodobné až velmi pravděpodobné. Bezpečnostní opatření jsou zavedena, ale jejich účinnost nepokrývá všechny potřebné aspekty a není pravidelně kontrolována. Jsou známé dílčí úspěšné pokusy o překonání bezpečnostních opatření.",
  "Zneužití zranitelnosti je velmi pravděpodobné až víceméně jisté. Bezpečnostní opatření nejsou realizována nebo je jejich účinnost značně omezena. Neprobíhá kontrola účinnosti bezpečnostních opatření. Jsou známé úspěšné pokusy překonání bezpečnostních opatření.",
];
/** Hodnota aktiva / dopad – vychází z přílohy č. 1 (nejvyšší z důvěrnosti, integrity, dostupnosti). */
const IMPACT4 = [
  "Narušení má zanedbatelné nebo krátkodobé dopady; aktivum je veřejné nebo nevyžaduje zvláštní ochranu.",
  "Narušení může způsobit omezené škody nebo dílčí narušení činností; výpadek delší než 1 pracovní den je nepřijatelný.",
  "Narušení může způsobit vážné škody, porušení právních či smluvních povinností nebo přímé ohrožení služby; výpadek delší než několik hodin je nepřijatelný.",
  "Narušení může způsobit velmi vážné nebo nevratné škody, ohrožení zdraví či života nebo zásadní narušení služby; výpadek delší než několik minut je nepřijatelný.",
];
const LIKELIHOOD4 = [
  "Scénář je málo pravděpodobný (ne častěji než jednou za 5 let) a opatření jsou účinná.",
  "Scénář je možný (jednou za 1–5 let) nebo opatření mají omezenou účinnost.",
  "Scénář je pravděpodobný (jednou za měsíc až rok) nebo opatření nepokrývají všechny aspekty.",
  "Scénář je velmi pravděpodobný (častěji než jednou za měsíc) nebo opatření chybí.",
];

const NAMES = {
  3: ["", "Nízká", "Střední", "Vysoká"],
  4: ["", "Nízká", "Střední", "Vysoká", "Kritická"],
  5: ["", "Velmi nízká", "Nízká", "Střední", "Vysoká", "Kritická"],
} as const;

/** Převod úrovně stupnice N → úroveň(ně) vyhlášky. */
const TO_DECREE: Record<ScaleLevels, number[][]> = {
  3: [[], [1], [2], [3, 4]],
  4: [[], [1], [2], [3], [4]],
  5: [[], [1], [1], [2], [3], [4]],
};
/** Převod úrovně vyhlášky (1–4) → stupnice N (konzervativně nahoru). */
const FROM_DECREE: Record<ScaleLevels, number[]> = { 3: [0, 1, 2, 3, 3], 4: [0, 1, 2, 3, 4], 5: [0, 2, 3, 4, 5] };

export function fromDecreeLevel(v: number | null | undefined, levels: ScaleLevels): number | null {
  return v ? (FROM_DECREE[levels][Math.min(4, Math.max(1, v))] ?? null) : null;
}

function describe(kind: ScaleKind, decree: number[]): string {
  const base = kind === "threat" ? THREAT4 : kind === "vulnerability" ? VULN4 : kind === "impact" ? IMPACT4 : LIKELIHOOD4;
  if (decree.length === 1) return base[decree[0]! - 1]!;
  return decree.map((d) => `${DECREE_LEVEL_NAMES[d]}: ${base[d - 1]}`).join(" / ");
}

/** Stupnice pro daný počet úrovní – u 4 úrovní přesně dle vyhlášky, u 3 a 5 s převodem na úrovně vyhlášky. */
export function scaleFor(kind: ScaleKind, levels: ScaleLevels): ScaleStep[] {
  return NAMES[levels].slice(1).map((name, i) => {
    const decree = TO_DECREE[levels][i + 1]!;
    let description = describe(kind, decree);
    if (levels === 5 && i === 0) description = `Nižší polovina úrovně „Nízká“ vyhlášky. ${description}`;
    if (levels === 5 && i === 1) description = `Horní polovina úrovně „Nízká“ vyhlášky. ${description}`;
    return { value: i + 1, name, description, decree };
  });
}

/* ---------- metodika (Administrace → Nastavení) ---------- */

export const RiskBoundsSchema = z.object({ maxLow: z.number().int().min(1), maxMedium: z.number().int().min(1), maxHigh: z.number().int().min(1) });
export type RiskBounds = z.infer<typeof RiskBoundsSchema>;

export const RiskPolicySchema = z.object({
  /** three_factor = hodnota aktiva × hrozba × zranitelnost (příl. 4 odst. 3), two_factor = dopad × pravděpodobnost scénáře (příl. 4 odst. 5). */
  method: z.enum(["three_factor", "two_factor"]).default("three_factor"),
  /** Počet úrovní stupnic (3×3, 4×4 = vyhláška, 5×5). */
  levels: z.union([z.literal(3), z.literal(4), z.literal(5)]).default(4),
  /** Horní hranice skóre pro úrovně rizika (včetně); nevyplněno = výchozí pro metodu a počet úrovní. */
  bounds: RiskBoundsSchema.nullable().default(null),
  /** Kritérium akceptovatelnosti (§ 8 odst. 1 písm. a): rizika do této úrovně včetně lze akceptovat. */
  acceptLevel: z.enum(["low", "medium"]).default("low"),
  /** Interval pravidelného hodnocení rizik v měsících (§ 8 odst. 1 písm. c: alespoň jednou ročně). */
  reviewMonths: z.number().int().min(1).max(12).default(12),
  /** Metodika hodnocení: „zkb409“ (příloha č. 4 vyhl. 409) nebo id importované metodiky (OCTAVE Allegro, vlastní YAML…). */
  methodology: z.string().trim().max(40).default("zkb409"),
  /** Kvantitativní analýza (FAIR): pásma očekávané roční ztráty v Kč a ochota nést riziko. */
  quant: QuantPolicySchema.default(DEFAULT_QUANT_POLICY),
});
export type RiskPolicy = z.infer<typeof RiskPolicySchema>;

export function maxScore(method: RiskPolicy["method"], levels: number) {
  return method === "three_factor" ? levels ** 3 : levels ** 2;
}

const DEFAULT_BOUNDS: Record<string, RiskBounds> = {
  "three_factor:3": { maxLow: 3, maxMedium: 8, maxHigh: 17 },
  "three_factor:4": { maxLow: 7, maxMedium: 17, maxHigh: 35 },
  "three_factor:5": { maxLow: 12, maxMedium: 36, maxHigh: 75 },
  "two_factor:3": { maxLow: 2, maxMedium: 4, maxHigh: 6 },
  "two_factor:4": { maxLow: 3, maxMedium: 7, maxHigh: 11 },
  "two_factor:5": { maxLow: 4, maxMedium: 9, maxHigh: 16 },
};
export function defaultBounds(method: RiskPolicy["method"], levels: number): RiskBounds {
  return DEFAULT_BOUNDS[`${method}:${levels}`] ?? DEFAULT_BOUNDS["three_factor:4"]!;
}
/** Platné hranice: vlastní z nastavení (pro aktuální metodu a počet úrovní), jinak výchozí. */
export function effectiveBounds(p: RiskPolicy, levels: number = p.levels): RiskBounds {
  return p.bounds && levels === p.levels ? p.bounds : defaultBounds(p.method, levels);
}
export function validateBounds(p: RiskPolicy): string | null {
  if (p.methodology && p.methodology !== BUILTIN_RISK_METHODOLOGY && !getRiskMethodology(p.methodology))
    return `Metodika hodnocení rizik „${p.methodology}“ neexistuje (importujte ji v Administraci → Metodiky).`;
  if (p.quant && !(p.quant.maxLow < p.quant.maxMedium && p.quant.maxMedium < p.quant.maxHigh)) return "Pásma očekávané roční ztráty musí být rostoucí.";
  const b = effectiveBounds(p);
  const max = maxScore(p.method, p.levels);
  return b.maxLow >= 1 && b.maxLow < b.maxMedium && b.maxMedium < b.maxHigh && b.maxHigh < max
    ? null
    : `Hranice úrovní rizika musí být rostoucí a menší než ${max}.`;
}

/** Návrh rizika z neošetřených zranitelností aktiva. */
export interface VulnRiskSuggestion {
  assetId: string;
  assetName: string;
  companyId: string;
  /** Ukázka (nejzávažnější, nejvýše 8) – celkový počet v `cveCount`. */
  cves: { id: string; cveId: string; severity: string; packageName: string | null }[];
  cveCount: number;
  criticalCount: number;
  maxSeverity: string;
  suggestedVulnLevel: number;
  suggestedImpact: number | null;
}
/**
 * Riziko ze zranitelností aktiva. Bez `vulnerabilityIds` vezme server všechny otevřené kritické a vysoké zranitelnosti
 * aktiva, které ještě nejsou navázané na riziko (aktivum jich může mít tisíce).
 */
/** Riziko za zranitelný balíček (ADR-049): všechna aktiva společnosti s otevřenými kritickými / vysokými CVE balíčku. */
export const RiskFromPackageInput = z.object({ packageName: z.string().trim().min(1).max(500), companyId: z.string().uuid().optional() });
export const RiskFromVulnsInput = z.object({ assetId: z.string().uuid(), vulnerabilityIds: z.array(z.string().uuid()).min(1).max(500).optional() });

export interface RiskValues {
  impact?: number | null;
  threatLevel?: number | null;
  vulnLevel?: number | null;
  likelihood?: number | null;
  /** Metodika, ve které bylo riziko hodnoceno (výchozí = metodika politiky). */
  methodologyKey?: string | null;
  /** Hodnoty faktorů u importované metodiky. */
  factorValues?: FactorValues | null;
}

/**
 * Skóre a úroveň rizika. `levels` = počet úrovní, ve kterém bylo riziko hodnoceno (výchozí aktuální metodika).
 */
export function riskScore(p: RiskPolicy, v: RiskValues, levels: number = p.levels): { score: number | null; level: RiskLevel | null; max: number } {
  // metodika, kterou bylo riziko hodnoceno (jinak aktuální metodika politiky)
  const mk = v.methodologyKey ?? p.methodology ?? BUILTIN_RISK_METHODOLOGY;
  if (mk !== BUILTIN_RISK_METHODOLOGY) {
    const def = getRiskMethodology(mk);
    if (!def) return { score: null, level: null, max: 0 };
    const r = scoreMethodology(def, v.factorValues ?? null);
    return { score: r.score, level: r.level, max: r.max };
  }
  const max = maxScore(p.method, levels);
  const score =
    p.method === "three_factor"
      ? v.impact && v.threatLevel && v.vulnLevel
        ? v.impact * v.threatLevel * v.vulnLevel
        : null
      : v.impact && v.likelihood
        ? v.impact * v.likelihood
        : null;
  if (score == null) return { score: null, level: null, max };
  const t = effectiveBounds(p, levels);
  const level: RiskLevel = score <= t.maxLow ? "low" : score <= t.maxMedium ? "medium" : score <= t.maxHigh ? "high" : "critical";
  return { score, level, max };
}

/** Akceptovatelnost úrovně – podle metodiky, ve které bylo riziko hodnoceno (jinak metodiky politiky). */
export function isAcceptable(p: RiskPolicy, level: RiskLevel | null, methodologyKey?: string | null) {
  if (!level) return false;
  const mk = methodologyKey ?? p.methodology;
  if (mk && mk !== BUILTIN_RISK_METHODOLOGY) {
    const def = getRiskMethodology(mk);
    if (def) return def.levels.some((l) => l.acceptable && l.mapsTo === level);
  }
  return RISK_LEVELS.indexOf(level) <= RISK_LEVELS.indexOf(p.acceptLevel);
}

/** Opatření navázané na riziko – pro návrh zbytkového rizika. */
export interface ControlForResidual {
  code: string | null;
  name: string;
  status: string;
  effectiveness: string;
  /** Výsledek posledního dokončeného testu opatření (v1.20, ADR-117). */
  lastTestResult?: string | null;
  /** Některý zapnutý monitor opatření je naposledy nesplněný (v1.20, ADR-117). */
  monitorFailing?: boolean;
}

/**
 * Účinnost opatření pro zbytkové riziko podle důkazů (v1.20, ADR-117): neúčinný poslední test nebo nesplněný monitor
 * = nezapočíst; účinné s výjimkami = nejvýš částečně účinné. Jinak deklarovaná účinnost.
 */
export function evidencedEffectiveness(c: ControlForResidual): { effectiveness: string; reason: "test_ineffective" | "monitor_failing" | "test_exceptions" | null } {
  if (c.lastTestResult === "ineffective") return { effectiveness: "ineffective", reason: "test_ineffective" };
  if (c.monitorFailing) return { effectiveness: "ineffective", reason: "monitor_failing" };
  if (c.lastTestResult === "effective_with_exceptions" && c.effectiveness === "effective") return { effectiveness: "partially_effective", reason: "test_exceptions" };
  return { effectiveness: c.effectiveness, reason: null };
}

export interface ResidualSuggestion {
  impact: number | null;
  threatLevel: number | null;
  vulnLevel: number | null;
  likelihood: number | null;
  /** O kolik stupňů se snížila zranitelnost / pravděpodobnost. */
  reduction: number;
  basis: string[];
}

/**
 * Návrh zbytkového rizika podle zavedených opatření a jejich účinnosti (příl. č. 4 – opatření snižují
 * zranitelnost, resp. pravděpodobnost scénáře; dopad a hrozba zůstávají):
 * účinné opatření −2 stupně, částečně účinné −1, neúčinné / nehodnocené 0; více účinných opatření −1 navíc;
 * nejvýše na stupeň 1. Jen pro metodiku dle vyhlášky – jde o návrh ke schválení člověkem.
 */
export function suggestResidual(r: { impact: number | null; threatLevel: number | null; vulnLevel: number | null; likelihood: number | null }, ctrls: ControlForResidual[], method: RiskPolicy["method"]): ResidualSuggestion | null {
  const impl = ctrls.filter((c) => c.status === "implemented").map((c) => ({ ...c, ev: evidencedEffectiveness(c) }));
  const eff = impl.filter((c) => c.ev.effectiveness === "effective");
  const part = impl.filter((c) => c.ev.effectiveness === "partially_effective");
  let reduction = eff.length ? 2 : part.length ? 1 : 0;
  if (eff.length >= 2) reduction++;
  const basis: string[] = [];
  const nm = (c: ControlForResidual) => `${c.code ? `${c.code} ` : ""}${c.name}`;
  for (const c of eff) basis.push(`${nm(c)} – zavedeno, účinné`);
  for (const c of part) basis.push(`${nm(c)} – zavedeno, částečně účinné${c.ev.reason === "test_exceptions" ? " (poslední test účinný s výjimkami)" : ""}`);
  for (const c of impl.filter((x) => x.ev.reason === "test_ineffective" || x.ev.reason === "monitor_failing"))
    basis.push(`${nm(c)} – ${c.ev.reason === "test_ineffective" ? "poslední test neúčinný" : "monitor nesplněn"} – nezapočteno`);
  const notCounted = ctrls.length - eff.length - part.length - impl.filter((x) => x.ev.reason === "test_ineffective" || x.ev.reason === "monitor_failing").length;
  if (notCounted) basis.push(`${notCounted} opatření nezavedeno nebo bez ověřené účinnosti – nezapočteno`);
  const down = (v: number | null) => (v == null ? null : Math.max(1, v - reduction));
  if (method === "three_factor") {
    if (r.impact == null || r.threatLevel == null || r.vulnLevel == null) return null;
    return { impact: r.impact, threatLevel: r.threatLevel, vulnLevel: down(r.vulnLevel), likelihood: null, reduction, basis };
  }
  if (r.impact == null || r.likelihood == null) return null;
  return { impact: r.impact, threatLevel: r.threatLevel, vulnLevel: down(r.vulnLevel), likelihood: down(r.likelihood), reduction, basis };
}

/** Hodnoty zbytkového rizika (po opatřeních) ve stejné metodice. */
export function residualValues(r: {
  methodologyKey?: string | null;
  residualImpact?: number | null;
  residualThreatLevel?: number | null;
  residualVulnLevel?: number | null;
  residualLikelihood?: number | null;
  residualFactorValues?: FactorValues | null;
}): RiskValues {
  return {
    methodologyKey: r.methodologyKey,
    impact: r.residualImpact ?? null,
    threatLevel: r.residualThreatLevel ?? null,
    vulnLevel: r.residualVulnLevel ?? null,
    likelihood: r.residualLikelihood ?? null,
    factorValues: r.residualFactorValues ?? null,
  };
}

/**
 * Pravděpodobnost pro teplotní matici (osa X, 1–N). U tříčlenné metodiky se odvodí z hrozba × zranitelnost
 * (odmocnina součinu, zaokrouhleno) – orientační zobrazení, skóre se počítá vždy celou funkcí.
 */
export function matrixLikelihood(p: RiskPolicy, v: RiskValues): number | null {
  if (p.method === "two_factor") return v.likelihood ?? null;
  if (!v.threatLevel || !v.vulnLevel) return null;
  return Math.round(Math.sqrt(v.threatLevel * v.vulnLevel));
}

/** Úroveň buňky matice dopad × pravděpodobnost (pro podbarvení) – dvoufaktorové hranice pro N úrovní. */
export function matrixCellLevel(levels: number, impact: number, likelihood: number): RiskLevel {
  const b = defaultBounds("two_factor", levels);
  const s = impact * likelihood;
  return s <= b.maxLow ? "low" : s <= b.maxMedium ? "medium" : s <= b.maxHigh ? "high" : "critical";
}

const lvl = z.number().int().min(1).max(5);

/* ---------- katalogy ---------- */

export const CatalogItemInput = z.object({
  code: z.string().trim().max(50).optional().nullable(),
  name: z.string().trim().min(1).max(500),
  category: z.string().trim().max(200).optional().nullable(),
  description: z.string().trim().max(5000).optional().nullable(),
  affectsC: z.boolean().default(true),
  affectsI: z.boolean().default(true),
  affectsA: z.boolean().default(true),
  isActive: z.boolean().default(true),
});
export type CatalogItemInput = z.input<typeof CatalogItemInput>;

export interface CatalogItemDto {
  id: string;
  kind: "threat" | "weakness";
  code: string | null;
  name: string;
  category: string | null;
  description: string | null;
  affectsC: boolean;
  affectsI: boolean;
  affectsA: boolean;
  isBuiltin: boolean;
  isActive: boolean;
  source: string | null;
  riskCount?: number;
}

export const CATALOG_SOURCE_409 = "vyhl. č. 409/2025 Sb., příl. č. 3";
export const CATALOG_SOURCE_82 = "vyhl. č. 82/2018 Sb. (historický)";

/**
 * Výchozí katalog – kategorie hrozeb a zranitelností z přílohy č. 3 vyhlášky č. 409/2025 Sb.
 * („musí povinná osoba zvážit při určování rizik, pokud jsou pro dané aktivum relevantní“).
 * Kategorie a ohrožené složky C/I/A jsou doplněny v CONTIX (lze upravit).
 */
export const BUILTIN_THREATS: { code: string; name: string; category: string; c: boolean; i: boolean; a: boolean }[] = [
  { code: "H01", name: "Porušení bezpečnostní politiky, provedení neoprávněných činností, zneužití oprávnění ze strany uživatelů, administrátorů, osob zastávajících bezpečnostní role, dodavatelů a vrcholného vedení", category: "Lidský faktor", c: true, i: true, a: true },
  { code: "H02", name: "Poškození nebo selhání technického anebo programového vybavení", category: "Technické selhání", c: false, i: true, a: true },
  { code: "H03", name: "Zneužití identity", category: "Kybernetický útok", c: true, i: true, a: false },
  { code: "H04", name: "Užívání programového vybavení v rozporu s licenčními podmínkami", category: "Právní a smluvní", c: false, i: false, a: true },
  { code: "H05", name: "Škodlivý kód", category: "Kybernetický útok", c: true, i: true, a: true },
  { code: "H06", name: "Narušení fyzické bezpečnosti", category: "Fyzická bezpečnost", c: true, i: true, a: true },
  { code: "H07", name: "Přerušení poskytování služeb elektronických komunikací, družicových služeb nebo dodávek elektrické energie nebo jiných důležitých služeb", category: "Infrastruktura a služby", c: false, i: false, a: true },
  { code: "H08", name: "Narušení dostupnosti primárních nebo podpůrných aktiv umístěných mimo území České republiky", category: "Jurisdikce a umístění", c: false, i: false, a: true },
  { code: "H09", name: "Zneužití nebo neoprávněná modifikace informací", category: "Kybernetický útok", c: true, i: true, a: false },
  { code: "H10", name: "Ztráta, odcizení nebo poškození aktiva", category: "Fyzická bezpečnost", c: true, i: true, a: true },
  { code: "H11", name: "Nedodržení smluvního závazku ze strany dodavatele", category: "Dodavatelé", c: true, i: true, a: true },
  { code: "H12", name: "Pochybení ze strany uživatelů, administrátorů, osob zastávajících bezpečnostní role, dodavatelů a vrcholného vedení", category: "Lidský faktor", c: true, i: true, a: true },
  { code: "H13", name: "Zneužití vnitřních prostředků, sabotáž", category: "Lidský faktor", c: true, i: true, a: true },
  { code: "H14", name: "Dlouhodobé přerušení poskytování služeb elektronických komunikací, družicových služeb, dodávky elektrické energie nebo jiných důležitých služeb", category: "Infrastruktura a služby", c: false, i: false, a: true },
  { code: "H15", name: "Zaměstnanci s nedostatečnou odbornou úrovní znalostí", category: "Lidský faktor", c: false, i: true, a: true },
  { code: "H16", name: "Cílený kybernetický útok pomocí sociálního inženýrství, použití špionážních technik", category: "Kybernetický útok", c: true, i: true, a: true },
  { code: "H17", name: "Zneužití vyměnitelných technických nosičů dat", category: "Kybernetický útok", c: true, i: true, a: false },
  { code: "H18", name: "Napadení (odposlech, modifikace, podvržení) elektronické komunikace, družicových služeb nebo jiných důležitých služeb", category: "Kybernetický útok", c: true, i: true, a: true },
  { code: "H19", name: "Závislost na dodavateli", category: "Dodavatelé", c: false, i: false, a: true },
  { code: "H20", name: "Zneužití cizí státní moci pro přístup k aktivům", category: "Jurisdikce a umístění", c: true, i: true, a: true },
  { code: "H21", name: "Zpřístupnění nebo předání aktiv na základě žádosti jiného státu", category: "Jurisdikce a umístění", c: true, i: false, a: false },
];

export const BUILTIN_WEAKNESSES: { code: string; name: string; category: string }[] = [
  { code: "Z01", name: "Nedostatečná údržba aktiv", category: "Technické" },
  { code: "Z02", name: "Zastaralost aktiv", category: "Technické" },
  { code: "Z03", name: "Nedostatečná ochrana perimetru", category: "Technické" },
  { code: "Z04", name: "Nedostatečné bezpečnostní povědomí uživatelů, administrátorů, osob zastávajících bezpečnostní role, dodavatelů a vrcholného vedení", category: "Organizační" },
  { code: "Z05", name: "Nedostatečné zálohování", category: "Technické" },
  { code: "Z06", name: "Nevhodné nastavení přístupových oprávnění", category: "Technické" },
  { code: "Z07", name: "Nedostatečné postupy a procesy pro detekování kybernetických bezpečnostních událostí a identifikování kybernetických bezpečnostních incidentů", category: "Organizační" },
  { code: "Z08", name: "Nedostatečné monitorování činnosti uživatelů a administrátorů a neschopnost odhalit činnost, která může mít vliv na bezpečnost regulované služby", category: "Organizační" },
  { code: "Z09", name: "Nedostatečné stanovení bezpečnostních pravidel a postupů, nepřesné nebo nejednoznačné vymezení práv a povinností uživatelů, administrátorů, osob zastávajících bezpečnostní role, dodavatelů a vrcholného vedení", category: "Organizační" },
  { code: "Z10", name: "Nedostatečná ochrana aktiv", category: "Technické" },
  { code: "Z11", name: "Nevhodně navržená bezpečná architektura", category: "Technické" },
  { code: "Z12", name: "Nedostatečná míra nezávislé kontroly", category: "Organizační" },
  { code: "Z13", name: "Neschopnost včasného odhalení pochybení ze strany uživatelů, administrátorů, osob zastávajících bezpečnostní role, dodavatelů a vrcholného vedení", category: "Organizační" },
  { code: "Z14", name: "Nedostatek zaměstnanců s potřebnou odbornou úrovní znalostí", category: "Organizační" },
  { code: "Z15", name: "Umístění aktiva mimo fyzickou kontrolu (například na území cizího státu)", category: "Jurisdikce a umístění" },
  { code: "Z16", name: "Umístění aktiva na území státu, o jehož právním prostředí nemá povinná osoba dostatečné povědomí", category: "Jurisdikce a umístění" },
  { code: "Z17", name: "Zranitelnosti odhalené při skenování zranitelností a penetračním testování", category: "Technické" },
];

/** Kódy katalogu dle vyhlášky č. 82/2018 Sb. (před 1. 11. 2025) – při aktualizaci se převedou na historické. */
export const LEGACY_82_CODES = {
  threat: Array.from({ length: 17 }, (_, i) => `H${String(i + 1).padStart(2, "0")}`),
  weakness: Array.from({ length: 12 }, (_, i) => `Z${String(i + 1).padStart(2, "0")}`),
};

/* ---------- riziko ---------- */

export const RiskInput = z.object({
  /** Společnost skupiny, do které záznam patří (výchozí = aktivní společnost). */
  companyId: z.string().uuid().optional(),
  code: z.string().trim().max(50).optional().nullable(),
  name: z.string().trim().min(1).max(500),
  description: z.string().trim().max(10000).optional().nullable(),
  threatId: z.string().uuid().nullable().optional(),
  weaknessId: z.string().uuid().nullable().optional(),
  /** Další hrozby a zranitelnosti scénáře (ADR-085) – hlavní je `threatId` / `weaknessId`. */
  moreThreatIds: z.array(z.string().uuid()).max(50).optional(),
  moreWeaknessIds: z.array(z.string().uuid()).max(50).optional(),
  ownerPositionId: z.string().uuid().nullable().optional(),
  status: RiskStatus.default("identified"),
  impact: lvl.nullable().optional(),
  threatLevel: lvl.nullable().optional(),
  vulnLevel: lvl.nullable().optional(),
  /** Hodnocení podle importované metodiky (OCTAVE…): faktor → hodnota, u faktoru po oblastech oblast → hodnota. */
  factorValues: z.record(z.string(), z.union([z.number(), z.record(z.string(), z.number())])).nullable().optional(),
  residualFactorValues: z.record(z.string(), z.union([z.number(), z.record(z.string(), z.number())])).nullable().optional(),
  /** Kvantitativní analýza FAIR (volitelná, doplňuje kvalitativní hodnocení). */
  quant: QuantInput.nullable().optional(),
  likelihood: lvl.nullable().optional(),
  treatment: Treatment.nullable().optional(),
  treatmentPlan: z.string().trim().max(10000).optional().nullable(),
  treatmentDue: z.string().date().nullable().optional(),
  residualImpact: lvl.nullable().optional(),
  residualThreatLevel: lvl.nullable().optional(),
  residualVulnLevel: lvl.nullable().optional(),
  residualLikelihood: lvl.nullable().optional(),
  assetIds: z.array(z.string().uuid()).default([]),
  processIds: z.array(z.string().uuid()).default([]),
  cveIds: z.array(z.string().uuid()).max(20000).default([]),
  /** Opatření (modul Opatření a shoda), která riziko snižují. */
  controlIds: z.array(z.string().uuid()).default([]),
});
export type RiskInput = z.input<typeof RiskInput>;
export const RiskPatch = patchOf(RiskInput.omit({ companyId: true })).extend({
  /** Zdůvodnění změny hodnocení – uloží se do historie přehodnocení (ADR-058). */
  reviewNote: z.string().trim().max(5000).optional(),
});

export const RiskListQuery = z.object({
  q: z.string().optional(),
  level: z.enum(RISK_LEVELS).optional(),
  status: RiskStatus.optional(),
  assetId: z.string().uuid().optional(),
  processId: z.string().uuid().optional(),
  threatId: z.string().uuid().optional(),
  /** Jen rizika s podněty k přehodnocení (ADR-058). */
  triggers: z.enum(["1"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export interface RiskListItem {
  id: string;
  companyId: string;
  code: string | null;
  name: string;
  status: RiskStatus;
  threatName: string | null;
  weaknessName: string | null;
  /** Další hrozby a zranitelnosti scénáře (názvy, ADR-085). */
  moreThreatNames: string[];
  moreWeaknessNames: string[];
  ownerPositionName: string | null;
  score: number | null;
  level: RiskLevel | null;
  residualScore: number | null;
  residualLevel: RiskLevel | null;
  treatment: Treatment | null;
  treatmentDue: string | null;
  assetCount: number;
  processCount: number;
  /** Počet úrovní stupnice, ve kterém bylo riziko hodnoceno. */
  scaleLevels: number;
  /** Hodnoceno v jiném počtu úrovní než aktuální metodika – je třeba přehodnotit. */
  outdatedScale: boolean;
  /** Riziko splňuje kritérium akceptovatelnosti (§ 8 odst. 1 písm. a). */
  acceptable: boolean | null;
  /** Kvantitativně: očekávaná roční ztráta (Kč) a úroveň podle pásem; null = riziko není kvantifikováno. */
  ale: number | null;
  quantLevel: RiskLevel | null;
  assessedAt: string | null;
  /** Hodnocení starší než interval pravidelného hodnocení. */
  reviewDue: boolean;
  /** Počet podnětů k přehodnocení od posledního hodnocení / potvrzení (ADR-058). */
  triggers: number;
  /** Poslední potvrzení hodnocení beze změny. */
  reviewedAt: string | null;
  updatedAt: string;
}

export interface RiskDetail extends RiskListItem {
  description: string | null;
  threatId: string | null;
  weaknessId: string | null;
  moreThreatIds: string[];
  moreWeaknessIds: string[];
  ownerPositionId: string | null;
  impact: number | null;
  threatLevel: number | null;
  vulnLevel: number | null;
  likelihood: number | null;
  treatmentPlan: string | null;
  residualImpact: number | null;
  residualThreatLevel: number | null;
  residualVulnLevel: number | null;
  residualLikelihood: number | null;
  /** Metodika, ve které bylo riziko hodnoceno, a hodnoty faktorů (u importovaných metodik). */
  methodologyKey: string;
  factorValues: FactorValues | null;
  residualFactorValues: FactorValues | null;
  /** Politika (metodika) společnosti rizika – pro formulář hodnocení. */
  policy: RiskPolicy;
  quant: QuantInput | null;
  quantResult: QuantResult | null;
  /** Návrh zbytkového rizika z účinnosti navázaných opatření (jen metodika dle vyhlášky). */
  residualSuggestion: ResidualSuggestion | null;
  assets: { id: string; name: string; assetType: string; healthStatus: string; confidentiality: number | null; integrity: number | null; availability: number | null }[];
  processes: { id: string; code: string | null; name: string }[];
  cves: { id: string; cveId: string; severity: string; assetName: string; status: string }[];
  /** Návrh dopadu = nejvyšší hodnocení CIA dotčených aktiv (podle toho, co hrozba ohrožuje), převedené na stupnici. */
  suggestedImpact: number | null;
  method: RiskPolicy["method"];
  maxScore: number;
  /** Opatření navázaná na riziko (modul Opatření). */
  controls: { id: string; code: string | null; name: string; status: string }[];
  /** Plán zvládání rizik – akce (§ 8 odst. 1 písm. g). */
  actions: TreatmentActionDto[];
  canEdit: boolean;
}

/* ---------- plán zvládání rizik (§ 8 odst. 1 písm. g vyhl. 409/2025) ---------- */

export const ACTION_STATUSES = ["planned", "in_progress", "done", "cancelled"] as const;
export const ActionStatus = z.enum(ACTION_STATUSES);
export type ActionStatus = z.infer<typeof ActionStatus>;
export const ACTION_LABELS: Record<ActionStatus, string> = { planned: "Plánováno", in_progress: "Probíhá", done: "Dokončeno", cancelled: "Zrušeno" };

export const TreatmentActionInput = z.object({
  controlId: z.string().uuid().nullable().optional(),
  /** 1. popis bezpečnostního opatření pro zvládání rizika */
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(10000).optional().nullable(),
  /** 2. cíle a přínosy */
  objective: z.string().trim().max(5000).optional().nullable(),
  /** 3. osoba zajišťující zavedení */
  ownerPositionId: z.string().uuid().nullable().optional(),
  /** 4. předpokládané lidské, finanční a technické zdroje */
  resourcesHuman: z.string().trim().max(2000).optional().nullable(),
  resourcesFinancial: z.string().trim().max(2000).optional().nullable(),
  resourcesTechnical: z.string().trim().max(2000).optional().nullable(),
  costEstimate: z.number().nonnegative().max(1e12).nullable().optional(),
  /** 5. požadovaný termín zavedení */
  dueDate: z.string().date().nullable().optional(),
  /** 7. konkrétní způsob realizace */
  realization: z.string().trim().max(10000).optional().nullable(),
  status: ActionStatus.default("planned"),
});
export type TreatmentActionInput = z.input<typeof TreatmentActionInput>;
export const TreatmentActionPatch = patchOf(TreatmentActionInput);

export interface TreatmentActionDto {
  id: string;
  riskId: string;
  riskCode: string | null;
  riskName: string;
  riskLevel: RiskLevel | null;
  controlId: string | null;
  controlCode: string | null;
  controlName: string | null;
  title: string;
  description: string | null;
  objective: string | null;
  ownerPositionId: string | null;
  ownerPositionName: string | null;
  resourcesHuman: string | null;
  resourcesFinancial: string | null;
  resourcesTechnical: string | null;
  costEstimate: number | null;
  dueDate: string | null;
  realization: string | null;
  status: ActionStatus;
  completedAt: string | null;
  overdue: boolean;
}

export interface RiskSummaryDto {
  byLevel: Record<RiskLevel | "unassessed", number>;
  byStatus: Record<RiskStatus, number>;
  /** matice [dopad 1–N][pravděpodobnost 1–N] → počet (N = počet úrovní metodiky) */
  matrix: number[][];
  levels: number;
  /** Otevřená rizika nad hranicí akceptovatelnosti bez ošetření. */
  untreated: number;
  /** Rizika, jejichž hodnocení je starší než interval pravidelného hodnocení. */
  reviewDue: number;
  outdatedScale: number;
  residualByLevel: Record<RiskLevel | "unassessed", number>;
  overdue: number;
  method: RiskPolicy["method"];
  /** Metodika a prahy (pro živý výpočet ve formuláři). */
  policy: RiskPolicy;
  /** Teplotní mapa maticové metodiky (ADR-083): počty [index stupnice osy y][index osy x]; null = metodika bez matice. */
  customMatrix: { methodology: string; counts: number[][] } | null;
}
