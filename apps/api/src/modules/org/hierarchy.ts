import { eq, inArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Db } from "../../db/client";
import { orgUnits, positionHolders, positions } from "../../db/schema";

/* ============================================================
 * Odpovědnost a eskalace v organizační struktuře (v1.60, ADR-155).
 * - funkce uživatele (pro přiřazení úkolů osobám – vlastník / garant aktiva je uživatel, úkoly jdou na funkce),
 * - eskalační řetězec funkce: vedoucí vlastního útvaru, pak vedoucí nadřazených útvarů až po vrchol.
 * Počítá se při čtení; nic se neukládá.
 * ============================================================ */

export interface OrgSnapshot {
  units: Map<string, { companyId: string; parentId: string | null }>;
  positions: Map<string, { orgUnitId: string; isManager: boolean; name: string }>;
  /** útvar → vedoucí funkce v něm */
  managersOf: Map<string, string[]>;
  /** uživatel → jeho funkce */
  positionsOfUser: Map<string, string[]>;
}

export async function orgSnapshot(db: Db): Promise<OrgSnapshot> {
  const [units, pos, holders] = await Promise.all([
    db.select({ id: orgUnits.id, companyId: orgUnits.companyId, parentId: orgUnits.parentId }).from(orgUnits),
    db.select({ id: positions.id, orgUnitId: positions.orgUnitId, isManager: positions.isManager, name: positions.name }).from(positions),
    db.select({ userId: positionHolders.userId, positionId: positionHolders.positionId }).from(positionHolders),
  ]);
  const snap: OrgSnapshot = { units: new Map(), positions: new Map(), managersOf: new Map(), positionsOfUser: new Map() };
  for (const u of units) snap.units.set(u.id, { companyId: u.companyId, parentId: u.parentId });
  for (const p of pos) {
    snap.positions.set(p.id, { orgUnitId: p.orgUnitId, isManager: p.isManager, name: p.name });
    if (p.isManager) snap.managersOf.set(p.orgUnitId, [...(snap.managersOf.get(p.orgUnitId) ?? []), p.id]);
  }
  for (const h of holders) snap.positionsOfUser.set(h.userId, [...(snap.positionsOfUser.get(h.userId) ?? []), h.positionId]);
  return snap;
}

/** Funkce uživatele pro úkol ve společnosti: přednostně ve stejné společnosti, nevedoucí před vedoucí (konkrétní role). */
export function positionOfUser(snap: OrgSnapshot, userId: string | null | undefined, companyId: string): string | null {
  if (!userId) return null;
  const list = snap.positionsOfUser.get(userId) ?? [];
  if (!list.length) return null;
  const score = (id: string) => {
    const p = snap.positions.get(id);
    const sameCo = p && snap.units.get(p.orgUnitId)?.companyId === companyId ? 0 : 2;
    return sameCo + (p?.isManager ? 1 : 0);
  };
  return [...list].sort((a, b) => score(a) - score(b) || a.localeCompare(b))[0] ?? null;
}

/**
 * Eskalační řetězec funkce: vedoucí funkce vlastního útvaru (pokud funkce sama není vedoucí), pak vedoucí
 * nadřazených útvarů. Bez duplicit, bez funkce samotné, nejvýš 10 úrovní.
 */
export function escalationChain(snap: OrgSnapshot, positionId: string): string[] {
  const p = snap.positions.get(positionId);
  if (!p) return [];
  const out: string[] = [];
  const seen = new Set<string>([positionId]);
  let unit: string | null = p.orgUnitId;
  for (let depth = 0; unit && depth < 10; depth++) {
    const mgr = (snap.managersOf.get(unit) ?? []).filter((m) => !seen.has(m)).sort()[0];
    if (mgr) {
      out.push(mgr);
      seen.add(mgr);
    }
    unit = snap.units.get(unit)?.parentId ?? null;
  }
  return out;
}

/** Úroveň eskalace: 7 dní po termínu = 1 (vedoucí útvaru), každý další týden o úroveň výš, nejvýš délka řetězce. */
export const ESCALATION_STEP_DAYS = 7;
export function escalationLevel(daysOverdue: number, chainLength: number): number {
  if (!chainLength) return 0;
  return Math.min(chainLength, Math.floor(daysOverdue / ESCALATION_STEP_DAYS));
}

/** Funkce, na které už položka po `daysOverdue` dnech eskalovala. */
export function escalatedTo(snap: OrgSnapshot, positionId: string, daysOverdue: number): string[] {
  const chain = escalationChain(snap, positionId);
  return chain.slice(0, escalationLevel(daysOverdue, chain.length));
}

export async function positionNames(db: Db, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db.select({ id: positions.id, name: positions.name }).from(positions).where(inArray(positions.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Útvar a všechny podřízené útvary (v1.76, ADR-169) – poddotaz se sloupcem id. */
export const unitSubtreeSql = (unitId: string) =>
  sql`(with recursive sub(id) as (select ${unitId}::uuid union select u.id from org_units u join sub on u.parent_id = sub.id) select id from sub)`;
/** Funkční místa útvaru a podřízených útvarů – poddotaz se sloupcem id. */
export const unitPositionsSql = (unitId: string) => sql`(select p.id from positions p where p.org_unit_id in ${unitSubtreeSql(unitId)})`;

/** Útvar musí patřit do společnosti záznamu (dodavatel, dokument – v1.80); prázdný útvar je v pořádku. */
export async function assertUnitInCompany(db: Db, unitId: string | null | undefined, companyId: string, message = "Útvar nepatří do společnosti záznamu") {
  if (!unitId) return;
  const [u] = await db.select({ companyId: orgUnits.companyId }).from(orgUnits).where(eq(orgUnits.id, unitId));
  if (!u || u.companyId !== companyId) throw new HTTPException(400, { message });
}
