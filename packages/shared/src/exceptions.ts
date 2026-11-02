import { z } from "zod";
/* ============================================================
 * Výjimky a přijatá rizika (v0.43, ADR-039) – jednotný přehled napříč moduly.
 * Nic se nepersistuje: výjimky zůstávají u svých záznamů (nález identity, porušení SoD, zranitelnost, riziko,
 * posouzení požadavku); přehled je počítá při čtení. Výjimka s termínem se blíží / je po termínu podle `exceptionState`.
 * ============================================================ */

export const EXCEPTION_KINDS = ["identity_finding", "sod_violation", "vulnerability", "risk_accepted", "requirement_na", "soc_suppression"] as const;
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];

export const EXCEPTION_STATES = ["expired", "expiring", "valid", "no_expiry"] as const;
export type ExceptionState = (typeof EXCEPTION_STATES)[number];

export const EXCEPTION_LABELS = {
  kind: {
    identity_finding: "Nález účtu (identity)",
    sod_violation: "Oddělení povinností (SoD)",
    vulnerability: "Zranitelnost",
    risk_accepted: "Přijaté riziko",
    requirement_na: "Neaplikované ustanovení",
    soc_suppression: "Potlačení alertů SOC",
  } satisfies Record<ExceptionKind, string>,
  state: { expired: "Po platnosti", expiring: "Brzy vyprší", valid: "Platná", no_expiry: "Bez termínu" } satisfies Record<ExceptionState, string>,
};

/** Dnů před koncem platnosti, kdy se výjimka hlásí jako „brzy vyprší“ (a objeví se v Mých povinnostech). */
export const EXCEPTION_LEAD_DAYS = 30;

export interface ExceptionDto {
  /** Stabilní klíč „druh:id“. */
  key: string;
  kind: ExceptionKind;
  id: string;
  companyId: string;
  title: string;
  detail: string | null;
  /** critical / high / medium / low (nálezy, zranitelnosti) nebo úroveň rizika. */
  severity: string | null;
  reason: string | null;
  acceptedByName: string | null;
  /** Uživatel, který výjimku udělil (upozornění před vypršením). */
  acceptedById: string | null;
  /** Platnost do (datum) – null = bez termínu (přijaté riziko, neaplikované ustanovení, výjimka bez data). */
  until: string | null;
  state: ExceptionState;
  /** Odkaz v aplikaci (cesta SPA). */
  link: string;
  /** Kompenzační opatření (v1.11, ADR-107). */
  compensating: { id: string; code: string | null; name: string; status: string | null }[];
  compensatingNote: string | null;
  /** Uživatel smí kompenzační opatření měnit (oprávnění k zápisu u druhu výjimky). */
  canEdit: boolean;
}

/** Kompenzační opatření k výjimce (v1.11) – nahradí celý seznam. */
export const ExceptionControlsInput = z.object({
  controlIds: z.array(z.string().uuid()).max(30),
  note: z.string().trim().max(2000).nullable().optional(),
});
export type ExceptionControlsInput = z.input<typeof ExceptionControlsInput>;

export interface ExceptionsSummary {
  total: number;
  byState: Record<ExceptionState, number>;
  byKind: Record<ExceptionKind, number>;
}

/** Stav výjimky k datu `today` (YYYY-MM-DD). */
export function exceptionState(until: string | null | undefined, today: string, leadDays = EXCEPTION_LEAD_DAYS): ExceptionState {
  if (!until) return "no_expiry";
  const u = until.slice(0, 10);
  if (u < today) return "expired";
  const lim = new Date(`${today}T00:00:00Z`);
  lim.setUTCDate(lim.getUTCDate() + leadDays);
  return u <= lim.toISOString().slice(0, 10) ? "expiring" : "valid";
}

const STATE_ORDER: Record<ExceptionState, number> = { expired: 0, expiring: 1, valid: 2, no_expiry: 3 };

/** Řazení: po platnosti → brzy vyprší → platné (podle data) → bez termínu. */
export function sortExceptions(list: ExceptionDto[]): ExceptionDto[] {
  return [...list].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || (a.until ?? "9999").localeCompare(b.until ?? "9999") || a.title.localeCompare(b.title, "cs"));
}

export function summarizeExceptions(list: ExceptionDto[]): ExceptionsSummary {
  const byState = Object.fromEntries(EXCEPTION_STATES.map((s) => [s, 0])) as Record<ExceptionState, number>;
  const byKind = Object.fromEntries(EXCEPTION_KINDS.map((k) => [k, 0])) as Record<ExceptionKind, number>;
  for (const e of list) {
    byState[e.state]++;
    byKind[e.kind]++;
  }
  return { total: list.length, byState, byKind };
}
