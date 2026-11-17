import { z } from "zod";
import { groupKey, type PersonStatus, type RequestStatus } from "./access";

/* ============================================================
 * IDM (v1.34, ADR-131): business role (balíček oprávnění podle útvaru / funkce), matice osoby × oprávnění,
 * průvodce nástup / přesun / odchod (JML), kontrola toxických kombinací (SoD) už při žádosti, detail osoby 360°.
 * ============================================================ */

export const JML_KINDS = ["joiner", "mover", "leaver"] as const;
export type JmlKind = (typeof JML_KINDS)[number];

export const IDM_LABELS = {
  jml: { joiner: "Nástup", mover: "Přesun / změna pozice", leaver: "Odchod" } satisfies Record<JmlKind, string>,
};

/* ---------------- role ---------------- */

const optName = (n: number) => z.string().trim().max(n).nullable().optional().transform((v) => v || null);

export const BusinessRoleInput = z.object({
  name: z.string().trim().min(2).max(200),
  description: optName(2000),
  ownerId: z.string().uuid().nullable().optional().transform((v) => v || null),
  /** Kritéria přiřazení: útvar a/nebo funkce (bez ohledu na velikost písmen). Bez kritérií = jen balíček, o který se žádá. */
  department: optName(200),
  jobTitle: optName(200),
  active: z.boolean().default(true),
  resourceIds: z.array(z.string().uuid()).max(200).default([]),
});
export type BusinessRoleInput = z.input<typeof BusinessRoleInput>;

export interface BusinessRoleDto {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  ownerId: string | null;
  ownerName: string | null;
  department: string | null;
  jobTitle: string | null;
  active: boolean;
  resources: { id: string; name: string; privileged: boolean; active: boolean }[];
  /** Osoby, kterým role podle kritérií patří (aktivní a nastupující). */
  members: number;
  /** Chybějící přidělení u členů (bez otevřené žádosti). */
  gaps: number;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Patří role osobě? Role bez kritérií se nepřiřazuje automaticky. Vyplněná kritéria musí sedět všechna. */
export function roleMatches(role: { department: string | null; jobTitle: string | null; active?: boolean }, person: { department: string | null; jobTitle: string | null }): boolean {
  if (role.active === false) return false;
  if (!role.department && !role.jobTitle) return false;
  if (role.department && norm(role.department) !== norm(person.department)) return false;
  if (role.jobTitle && norm(role.jobTitle) !== norm(person.jobTitle)) return false;
  return true;
}

/* ---------------- SoD při žádosti ---------------- */

export interface SodRuleLite {
  id: string;
  name: string;
  severity: string;
  sideA: { groups: string[]; positionIds: string[] };
  sideB: { groups: string[]; positionIds: string[] };
}

export interface SodConflict {
  ruleId: string;
  rule: string;
  severity: string;
  /** Co osobu staví na stranu A / B (skupiny, oprávnění, funkční místa). */
  sideA: string[];
  sideB: string[];
}

/**
 * Konflikty, které by vznikly přidáním `adding` (klíče skupin – groupKey) k současnému stavu osoby.
 * Hlásí jen pravidla, která přidání nově porušuje (stávající porušení řeší přehled SoD v Identitách).
 */
export function sodConflictsFor(
  rules: SodRuleLite[],
  current: { groups: string[]; positionIds: string[]; positionNames?: Record<string, string> },
  adding: string[],
): SodConflict[] {
  const cur = new Set(current.groups.map(groupKey));
  const add = new Set(adding.map(groupKey));
  const pos = new Set(current.positionIds);
  const pname = (id: string) => `funkční místo ${current.positionNames?.[id] ?? id}`;
  const out: SodConflict[] = [];
  for (const r of rules) {
    const side = (s: SodRuleLite["sideA"], set: Set<string>) => [
      ...s.groups.filter((g) => set.has(groupKey(g))),
      ...(set === cur ? s.positionIds.filter((p) => pos.has(p)).map(pname) : []),
    ];
    const aNow = side(r.sideA, cur);
    const bNow = side(r.sideB, cur);
    const aAdd = side(r.sideA, add);
    const bAdd = side(r.sideB, add);
    const a = [...new Set([...aNow, ...aAdd])];
    const b = [...new Set([...bNow, ...bAdd])];
    const before = aNow.length > 0 && bNow.length > 0;
    if (a.length && b.length && !before) out.push({ ruleId: r.id, rule: r.name, severity: r.severity, sideA: a, sideB: b });
  }
  return out;
}

/* ---------------- JML ---------------- */

export const JmlPreviewInput = z.object({
  personId: z.string().uuid(),
  kind: z.enum(JML_KINDS),
  department: optName(200),
  jobTitle: optName(200),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().transform((v) => v || null),
});
export type JmlPreviewInput = z.input<typeof JmlPreviewInput>;

export const JmlApplyInput = JmlPreviewInput.extend({
  add: z.array(z.string().uuid()).max(300).default([]),
  remove: z.array(z.string().uuid()).max(300).default([]),
  justification: z.string().trim().max(2000).nullable().optional().transform((v) => v || null),
});
export type JmlApplyInput = z.input<typeof JmlApplyInput>;

export interface JmlItem {
  resourceId: string;
  name: string;
  privileged: boolean;
  /** Role, ze kterých položka plyne. */
  roles: string[];
  /** Doporučeno (předvybráno). */
  suggested: boolean;
  /** Proč: role / mimo role / už je otevřená žádost. */
  note: string | null;
  sod: SodConflict[];
}

export interface JmlPreviewDto {
  person: { id: string; name: string; department: string | null; jobTitle: string | null; status: PersonStatus; endDate: string | null };
  kind: JmlKind;
  rolesBefore: string[];
  rolesAfter: string[];
  add: JmlItem[];
  remove: JmlItem[];
  keep: JmlItem[];
  /** Otevřené žádosti o přidělení, které odchod zruší. */
  cancelRequests: number;
}

export interface JmlResultDto {
  requests: number;
  cancelled: number;
  personUpdated: boolean;
  /** Odchod v budoucnu – oprávnění odebere denní kontrola v den odchodu. */
  scheduled: boolean;
}

/**
 * Návrh JML z rolí. Nástup: přidat vše z rolí. Přesun: přidat chybějící z nových rolí, odebrat to, co plynulo jen
 * ze starých rolí (předvybráno) – přidělení mimo role se nabídnou k odebrání bez předvýběru. Odchod: odebrat vše.
 */
export function jmlPlan(o: {
  kind: JmlKind;
  rolesBefore: { name: string; resourceIds: string[] }[];
  rolesAfter: { name: string; resourceIds: string[] }[];
  granted: string[];
  openGrant: string[];
  openRevoke: string[];
}): { add: { id: string; roles: string[]; suggested: boolean; note: string | null }[]; remove: { id: string; roles: string[]; suggested: boolean; note: string | null }[]; keep: { id: string; roles: string[] }[] } {
  const rolesOf = (list: typeof o.rolesAfter, id: string) => list.filter((r) => r.resourceIds.includes(id)).map((r) => r.name);
  const granted = new Set(o.granted);
  const openGrant = new Set(o.openGrant);
  const openRevoke = new Set(o.openRevoke);
  const after = new Set(o.rolesAfter.flatMap((r) => r.resourceIds));
  const before = new Set(o.rolesBefore.flatMap((r) => r.resourceIds));
  const add: ReturnType<typeof jmlPlan>["add"] = [];
  const remove: ReturnType<typeof jmlPlan>["remove"] = [];
  const keep: ReturnType<typeof jmlPlan>["keep"] = [];
  if (o.kind === "leaver") {
    for (const id of granted) remove.push({ id, roles: rolesOf(o.rolesBefore, id), suggested: !openRevoke.has(id), note: openRevoke.has(id) ? "open" : null });
    return { add, remove, keep };
  }
  for (const id of after) {
    if (granted.has(id)) keep.push({ id, roles: rolesOf(o.rolesAfter, id) });
    else add.push({ id, roles: rolesOf(o.rolesAfter, id), suggested: !openGrant.has(id), note: openGrant.has(id) ? "open" : null });
  }
  if (o.kind === "mover")
    for (const id of granted) {
      if (after.has(id)) continue;
      const fromOldRole = before.has(id);
      remove.push({ id, roles: rolesOf(o.rolesBefore, id), suggested: fromOldRole && !openRevoke.has(id), note: openRevoke.has(id) ? "open" : fromOldRole ? null : "outside" });
    }
  else for (const id of granted) if (!after.has(id)) keep.push({ id, roles: [] });
  return { add, remove, keep };
}

/* ---------------- matice ---------------- */

/**
 * Stav buňky osoba × oprávnění:
 * ok = evidováno (a u skupiny AD i členem), granted = evidováno (bez kontroly AD / AD chybí – viz adMissing),
 * ad_only = člen skupiny v AD bez schválení, pending = otevřená žádost o přidělení, revoking = otevřená žádost
 * o odebrání, expected = role očekává, chybí.
 */
export const MATRIX_STATES = ["ok", "granted", "ad_missing", "ad_only", "pending", "revoking", "expected"] as const;
export type MatrixState = (typeof MATRIX_STATES)[number];

export interface MatrixDto {
  people: { id: string; name: string; department: string | null; jobTitle: string | null; status: PersonStatus }[];
  resources: { id: string; name: string; privileged: boolean; adGroup: string | null; kind: string }[];
  /** "personId:resourceId" → stav */
  cells: Record<string, MatrixState>;
  departments: string[];
  truncated: boolean;
}

export function matrixState(o: { granted: boolean; inAd: boolean | null; pendingGrant: boolean; pendingRevoke: boolean; expected: boolean }): MatrixState | null {
  if (o.granted) {
    if (o.pendingRevoke) return "revoking";
    if (o.inAd === false) return "ad_missing";
    return o.inAd ? "ok" : "granted";
  }
  if (o.pendingGrant) return "pending";
  if (o.inAd) return "ad_only";
  if (o.expected) return "expected";
  return null;
}

/* ---------------- přehled ---------------- */

export interface IdmOverviewDto {
  manage: boolean;
  my: { toApprove: number; toCertify: number };
  flow: { pending: number; approved: number; toProvision: number; done30: number; rejected30: number };
  risks: {
    unapproved: number;
    leaversInAd: number;
    unknownAccounts: number;
    adMissing: number;
    privilegedGrants: number;
    expiring14: number;
    sodOpen: number;
    roleGaps: number;
    certOverdue: number;
  };
  people: { total: number; joiners14: number; leavers14: number; withoutManager: number; withoutAccount: number };
  /** Nejbližší události (nástupy, odchody, konce platnosti). */
  upcoming: { date: string; kind: "joiner" | "leaver" | "expiry"; personId: string; person: string; detail: string | null }[];
  lastSyncAt: string | null;
}

/* ---------------- detail osoby ---------------- */

export interface PersonOverviewDto {
  person: {
    id: string;
    companyId: string;
    name: string;
    email: string | null;
    login: string | null;
    personalNumber: string | null;
    department: string | null;
    jobTitle: string | null;
    kind: string;
    status: PersonStatus;
    startDate: string | null;
    endDate: string | null;
    managerId: string | null;
    managerName: string | null;
  };
  reports: { id: string; name: string; status: PersonStatus }[];
  roles: { id: string; name: string; missing: string[] }[];
  grants: {
    id: string;
    resourceId: string;
    name: string;
    kind: string;
    privileged: boolean;
    since: string;
    validUntil: string | null;
    origin: string | null;
    inAd: boolean | null;
    roles: string[];
    revoking: boolean;
  }[];
  accounts: { id: string; source: string; login: string; enabled: boolean; lastLogonAt: string | null; groups: { name: string; resourceId: string | null; approved: boolean }[] }[];
  requests: { id: string; resourceName: string; action: string; status: RequestStatus; origin: string; createdAt: string }[];
  sod: { rule: string; severity: string; status: string }[];
  history: { at: string; text: string }[];
}
