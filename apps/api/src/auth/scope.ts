/**
 * Rozsah dat podle společností skupiny.
 *
 * - Role je přidělena ke společnosti a platí pro ni i pro všechny její dceřiné společnosti
 *   (role u kořene = celá skupina).
 * - Požadavek nese aktivní společnost v hlavičce `x-contix-company` (nebo `group` = souhrnný pohled).
 * - Oprávnění v rozsahu: u jedné společnosti její oprávnění; u souhrnného pohledu průnik oprávnění
 *   přes všechny dostupné společnosti (zápis v souhrnném pohledu je tak vždy oprávněný pro každý záznam).
 * - Správa systému (admin:*, audit_log:read) platí jen z rolí přidělených kořenové společnosti.
 */
import { type RegulatoryProfile, profileOf, BUILTIN_RISK_METHODOLOGY,
  regulatoryPack,
  ancestorsOf,
  COMPANY_HEADER,
  GROUP_SCOPE,
  PERMISSION_KEYS,
  ROOT_COMPANY_ID,
  SettingsSchema,
  type Permission,
  type RiskPolicy,
  type Settings,
} from "@contix/shared";
import { inArray, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Db } from "../db/client";
import { companies, groupMembers, groupRoles, roles, userRoles } from "../db/schema";
import { getSettings, type AppEnv } from "./service";

export type CompanyRow = typeof companies.$inferSelect;

export interface Scope {
  /** Společnosti, jejichž data požadavek vidí. */
  ids: string[];
  /** Aktivní společnost; null = souhrnný pohled za skupinu. */
  active: string | null;
  /** Všechny společnosti, ke kterým má uživatel nějakou roli (včetně zděděné). */
  accessible: string[];
  byCompany: Map<string, Set<Permission>>;
  canGroupView: boolean;
  home: string;
}

const SYSTEM_PERMS: Permission[] = ["admin:users", "admin:roles", "admin:settings", "audit_log:read"];

let cache: { at: number; rows: CompanyRow[] } | null = null;

export async function getCompanies(db: Db): Promise<CompanyRow[]> {
  if (cache && Date.now() - cache.at < 5_000) return cache.rows;
  const rows = await db.select().from(companies);
  cache = { at: Date.now(), rows };
  return rows;
}
export const invalidateCompanies = () => {
  cache = null;
};

/** Oprávnění uživatele po společnostech (s dědičností dolů ve stromu). */
export async function permissionsByCompany(db: Db, userId: string) {
  const rows = await db.execute<{ company_id: string; permissions: string[] }>(sql`
    select ur.company_id, r.permissions from ${userRoles} ur join ${roles} r on r.id = ur.role_id where ur.user_id = ${userId}
    union all
    select gr.company_id, r.permissions from ${groupRoles} gr join ${groupMembers} gm on gm.group_id = gr.group_id
      join ${roles} r on r.id = gr.role_id where gm.user_id = ${userId}`);
  const all = await getCompanies(db);
  const active = all.filter((c) => c.active);
  const by = new Map<string, Set<Permission>>();
  for (const c of active) {
    const anc = new Set(ancestorsOf(all, c.id));
    const set = new Set<Permission>();
    for (const r of rows) {
      if (!anc.has(r.company_id)) continue;
      for (const p of r.permissions) {
        if (!(PERMISSION_KEYS as string[]).includes(p)) continue;
        if (SYSTEM_PERMS.includes(p as Permission) && r.company_id !== ROOT_COMPANY_ID) continue;
        set.add(p as Permission);
      }
    }
    if (set.size) by.set(c.id, set);
  }
  const root = new Set(rows.filter((r) => r.company_id === ROOT_COMPANY_ID).flatMap((r) => r.permissions));
  return { by, rootHasRoles: root.size > 0 };
}

/** Rozsah požadavku z hlavičky; bez hlavičky = souhrnný pohled (u uživatele s rolí pro skupinu) nebo domovská společnost. */
export async function resolveScope(db: Db, userId: string, home: string, requested?: string | null): Promise<{ scope: Scope; permissions: Set<Permission> }> {
  const { by, rootHasRoles } = await permissionsByCompany(db, userId);
  const accessible = [...by.keys()];
  let active: string | null = null;
  if (requested && requested !== GROUP_SCOPE && by.has(requested)) active = requested;
  else if (!requested && !rootHasRoles && accessible.length) active = by.has(home) ? home : accessible[0]!;
  const ids = active ? [active] : accessible;
  let permissions: Set<Permission>;
  if (active) permissions = new Set(by.get(active));
  else if (!accessible.length) permissions = new Set();
  else {
    const sets = accessible.map((id) => by.get(id)!);
    permissions = new Set([...sets[0]!].filter((p) => sets.every((s) => s.has(p))));
  }
  // správa systému se odvozuje jen od kořene, nezávisle na zvoleném rozsahu
  const rootPerms = by.get(ROOT_COMPANY_ID);
  for (const p of SYSTEM_PERMS) if (rootPerms?.has(p)) permissions.add(p);
  return { scope: { ids, active, accessible, byCompany: by, canGroupView: rootHasRoles || accessible.length > 1, home }, permissions };
}

/** Hlavička, nebo parametr `_co` (pro odkazy otevírané v novém okně – tisk, CSV). */
export const requestedCompany = (c: Context) => c.req.header(COMPANY_HEADER) ?? c.req.query("_co") ?? null;

/* ---------------- pomocníci pro routy ---------------- */

export function scopeOf(c: Context<AppEnv>): Scope {
  const s = c.get("auth")?.scope;
  if (!s) throw new HTTPException(401, { message: "Nepřihlášen" });
  return s;
}

/** Podmínka `sloupec in (společnosti v rozsahu)`. */
export function inScope(c: Context<AppEnv>, column: PgColumn | SQL): SQL {
  const ids = scopeOf(c).ids;
  if (!ids.length) return sql`false`;
  return inArray(column as PgColumn, ids);
}

/** 404, pokud záznam nepatří do rozsahu požadavku. */
export function assertScope(c: Context<AppEnv>, companyId: string | null | undefined, what = "Záznam nenalezen") {
  if (!companyId || !scopeOf(c).ids.includes(companyId)) throw new HTTPException(404, { message: what });
}

/** Má uživatel oprávnění v konkrétní společnosti? */
export function hasPermIn(c: Context<AppEnv>, perm: Permission, companyId: string) {
  return !!scopeOf(c).byCompany.get(companyId)?.has(perm);
}

/**
 * Společnost, do které se zakládá nový záznam: požadovaná (musí být v rozsahu a mít oprávnění),
 * jinak aktivní, jinak domovská, jinak první dostupná.
 */
export function targetCompany(c: Context<AppEnv>, requested?: string | null, perm?: Permission): string {
  const s = scopeOf(c);
  const pick = requested ?? s.active ?? (s.ids.includes(s.home) ? s.home : s.ids[0]);
  if (!pick || !s.ids.includes(pick)) throw new HTTPException(400, { message: "Zvolte společnost, do které záznam patří." });
  if (perm && !hasPermIn(c, perm, pick)) throw new HTTPException(403, { message: "Nemáte oprávnění v této společnosti" });
  return pick;
}

/* ---------------- nastavení podle společnosti ---------------- */

/** Nastavení společnosti = globální nastavení + identita společnosti + zděděná přepsání (od kořene k ní). */
export function companySettings(base: Settings, all: CompanyRow[], companyId: string): Settings {
  const chain = ancestorsOf(all, companyId).reverse();
  const merged: Settings = { ...base };
  for (const id of chain) {
    const co = all.find((x) => x.id === id);
    if (!co) continue;
    const o = co.overrides ?? {};
    if (o.riskPolicy) merged.riskPolicy = o.riskPolicy;
    if (o.changeCriteria) merged.changeCriteria = o.changeCriteria;
    if (o.incidentTolerance !== undefined) merged.incidentTolerance = o.incidentTolerance;
    if (o.trustServiceProvider !== undefined) merged.trustServiceProvider = o.trustServiceProvider;
    if (o.soc2Scope !== undefined) merged.soc2Scope = o.soc2Scope;
    if (o.frameworks !== undefined) merged.frameworks = o.frameworks;
    if (o.cisIg !== undefined) merged.cisIg = o.cisIg;
  }
  const co = all.find((x) => x.id === companyId);
  if (co) {
    merged.organizationName = co.name;
    merged.organizationIco = co.ico ?? "";
    merged.organizationAddress = co.address ?? "";
    merged.regulatedServices = co.regulatedServices ?? "";
    merged.regime = (co.regime as Settings["regime"]) ?? "higher";
    merged.pack = (co.pack as Settings["pack"]) ?? "cz";
    merged.primaryFramework = co.primaryFramework ?? null;
    merged.doraEntity = co.doraEntity ?? false;
    // metodika rizik z profilu (ADR-080): bez vlastní metodiky v řetězci a s výchozí metodikou kořene → výchozí podle balíčku společnosti
    const root = all.find((x) => !x.parentId);
    const ownRisk = chain.some((id) => all.find((x) => x.id === id)?.overrides?.riskPolicy);
    const rootDefault = regulatoryPack(root?.pack).riskMethodology;
    const mine = regulatoryPack(co.pack).riskMethodology;
    if (!ownRisk && mine !== rootDefault && (merged.riskPolicy.methodology || BUILTIN_RISK_METHODOLOGY) === rootDefault) merged.riskPolicy = { ...merged.riskPolicy, methodology: mine };
  }
  return SettingsSchema.parse(merged);
}

/** Politika rizik pro každou společnost (rizika v souhrnném pohledu se hodnotí metodikou své společnosti). */
export async function riskPolicies(db: Db, base: Settings): Promise<Map<string, RiskPolicy>> {
  const all = await getCompanies(db);
  return new Map(all.map((co) => [co.id, companySettings(base, all, co.id).riskPolicy]));
}

/** Nastavení pro konkrétní společnost, nebo pro aktivní (v souhrnném pohledu domovskou / kořenovou). */
export async function settingsFor(db: Db, c: Context<AppEnv> | null, companyId?: string | null): Promise<Settings> {
  const base = await getSettings(db);
  const all = await getCompanies(db);
  let id = companyId ?? null;
  if (!id && c) {
    const s = c.get("auth")?.scope;
    id = s?.active ?? (s && s.ids.includes(s.home) ? s.home : (s?.ids[0] ?? null));
  }
  return companySettings(base, all, id ?? ROOT_COMPANY_ID);
}

/** Společnosti v rozsahu + jejich nadřazené (holding) – pro výběr sdílených záznamů (aktiva, funkční místa). */
export async function visibleIds(db: Db, c: Context<AppEnv>): Promise<string[]> {
  const all = await getCompanies(db);
  return [...new Set(scopeOf(c).ids.flatMap((id) => ancestorsOf(all, id)))];
}

/**
 * Jediná společnost pro operace, které dávají smysl jen za jednu povinnou osobu (SoA, dokumenty ISMS).
 * Aktivní společnost; v souhrnném pohledu jen pokud je v rozsahu jediná, nebo explicitně zadaná.
 */
export function soleCompany(c: Context<AppEnv>, requested?: string | null): string {
  const s = scopeOf(c);
  if (requested) {
    if (!s.ids.includes(requested)) throw new HTTPException(404, { message: "Společnost nenalezena" });
    return requested;
  }
  if (s.active) return s.active;
  if (s.ids.length === 1) return s.ids[0]!;
  throw new HTTPException(400, { message: "Vyberte společnost (prohlášení o aplikovatelnosti a dokumenty ISMS se vedou za každou společnost zvlášť)." });
}

/** Regulatorní profil každé společnosti (hromadně – bez dotazů v cyklu). */
export async function profilesByCompany(db: Db): Promise<Map<string, RegulatoryProfile>> {
  const [base, all] = await Promise.all([getSettings(db), getCompanies(db)]);
  return new Map(all.map((co) => [co.id, profileOf(companySettings(base, all, co.id))]));
}
