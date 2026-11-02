import { z } from "zod";
import { patchOf } from "./zutil";
import { RiskPolicySchema } from "./risk";

/* ============================================================
 * Skupina společností (holding) a jednotlivé společnosti.
 *  - Strom: kořen = holding (nebo jediná organizace), pod ním společnosti (příp. sub-holdingy).
 *  - Každý záznam (aktivum, riziko, proces…) patří právě jedné společnosti; vazby mezi záznamy
 *    různých společností jsou povolené (sdílené služby holdingu, vlastník z mateřské společnosti).
 *  - Role se přidělují ke společnosti a platí i pro všechny její dceřiné společnosti
 *    (role přidělená holdingu = platí pro celou skupinu).
 *  - Každá společnost je samostatná povinná osoba dle zákona č. 264/2025 Sb. (vlastní režim, SoA, dokumenty).
 * ============================================================ */

/** Výchozí (kořenová) společnost – vzniká migrací z dosavadního nastavení organizace. */
export const ROOT_COMPANY_ID = "00000000-0000-4000-8000-000000000001";

export const COMPANY_KINDS = ["holding", "company"] as const;
export type CompanyKind = (typeof COMPANY_KINDS)[number];
export const COMPANY_KIND_LABELS: Record<CompanyKind, string> = { holding: "Holding / mateřská společnost", company: "Společnost" };

/** Hodnota hlavičky / přepínače pro souhrnný pohled za celou skupinu. */
export const GROUP_SCOPE = "group";
export const COMPANY_HEADER = "x-contix-company";

/** Nastavení, která si společnost může určit odlišně od skupiny (jinak se dědí z mateřské). */
export const CompanyOverrides = z.object({
  riskPolicy: RiskPolicySchema.optional(),
  changeCriteria: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
  incidentTolerance: z.string().trim().max(3000).optional(),
  trustServiceProvider: z.boolean().optional(),
  soc2Scope: z.array(z.enum(["A1", "C1", "PI1", "P"])).optional(),
  frameworks: z.array(z.union([z.enum(["iso27001", "dora", "nis2", "soc2", "iso9001", "cis8"]), z.string().regex(/^x-[a-z0-9][a-z0-9-]{1,39}$/) as unknown as z.ZodType<`x-${string}`>])).max(20).optional(),
  cisIg: z.number().int().min(1).max(3).optional(),
});
export type CompanyOverrides = z.infer<typeof CompanyOverrides>;

export const CompanyInput = z.object({
  parentId: z.string().uuid().nullable().optional(),
  kind: z.enum(COMPANY_KINDS).default("company"),
  name: z.string().trim().min(1).max(300),
  shortName: z.string().trim().max(50).optional().nullable(),
  ico: z
    .string()
    .trim()
    .regex(/^\d{8}$/, "IČO má 8 číslic")
    .or(z.literal(""))
    .optional()
    .nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  regulatedServices: z.string().trim().max(2000).optional().nullable(),
  regime: z.enum(["higher", "lower", "none"]).default("higher"),
  /** Regulatorní balíček a hlavní rámec (ADR-080). */
  pack: z.enum(["cz", "sk", "pl", "de", "at", "generic"]).default("cz"),
  primaryFramework: z
    .string()
    .regex(/^([a-z0-9]{2,12}|x-[a-z0-9][a-z0-9-]{1,39})$/)
    .nullable()
    .default(null),
  /** Finanční subjekt podle DORA (ADR-084). */
  doraEntity: z.boolean().default(false),
  active: z.boolean().default(true),
  overrides: CompanyOverrides.default({}),
});
export type CompanyInput = z.input<typeof CompanyInput>;
export const CompanyPatch = patchOf(CompanyInput);

export interface CompanyDto {
  id: string;
  parentId: string | null;
  kind: CompanyKind;
  name: string;
  shortName: string | null;
  ico: string | null;
  address: string | null;
  regulatedServices: string | null;
  regime: "higher" | "lower" | "none";
  pack: "cz" | "sk" | "pl" | "de" | "at" | "generic";
  primaryFramework: string | null;
  doraEntity: boolean;
  active: boolean;
  overrides: CompanyOverrides;
  /** Hloubka ve stromu (0 = kořen). */
  depth: number;
  /** Cesta od kořene (názvy). */
  path: string[];
}

/** Společnost, ke které má přihlášený uživatel přístup (pro přepínač). */
export interface ScopeCompany {
  id: string;
  parentId: string | null;
  name: string;
  shortName: string | null;
  kind: CompanyKind;
  depth: number;
  /** Režim povinností: vyšší (vyhl. 409), nižší (vyhl. 410), neregulovaná. */
  regime: "higher" | "lower" | "none";
  /** Regulatorní balíček a hlavní rámec – profil počítá `profileOf` (ADR-080). */
  pack: "cz" | "sk" | "pl" | "de" | "at" | "generic";
  primaryFramework: string | null;
  doraEntity: boolean;
}

/** Přiřazení role ke společnosti (role platí i pro dceřiné společnosti). */
export const RoleAssignment = z.object({ roleId: z.string().uuid(), companyId: z.string().uuid() });
export type RoleAssignment = z.infer<typeof RoleAssignment>;

/** Seřadí společnosti do stromu (DFS) a doplní hloubku a cestu. */
export function companyTree<T extends { id: string; parentId: string | null; name: string }>(rows: T[]): (T & { depth: number; path: string[] })[] {
  const out: (T & { depth: number; path: string[] })[] = [];
  const byParent = new Map<string | null, T[]>();
  for (const r of rows) {
    const p = r.parentId && rows.some((x) => x.id === r.parentId) ? r.parentId : null;
    byParent.set(p, [...(byParent.get(p) ?? []), r]);
  }
  const walk = (parent: string | null, depth: number, path: string[]) => {
    for (const r of (byParent.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name, "cs"))) {
      const p = [...path, r.name];
      out.push({ ...r, depth, path: p });
      walk(r.id, depth + 1, p);
    }
  };
  walk(null, 0, []);
  return out;
}

/** ID společnosti a všech jejích potomků. */
export function descendantsOf(rows: { id: string; parentId: string | null }[], id: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const r of rows) if (r.parentId === out[i] && !out.includes(r.id)) out.push(r.id);
  return out;
}

/** ID společnosti a všech jejích předků (od společnosti ke kořeni). */
export function ancestorsOf(rows: { id: string; parentId: string | null }[], id: string): string[] {
  const out: string[] = [];
  let cur: string | null = id;
  while (cur && !out.includes(cur)) {
    out.push(cur);
    cur = rows.find((r) => r.id === cur)?.parentId ?? null;
  }
  return out;
}
