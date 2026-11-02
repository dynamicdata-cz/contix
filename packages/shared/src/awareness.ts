import { z } from "zod";
import { Audience, EMPTY_AUDIENCE } from "./policies";
import { patchOf } from "./zutil";

/* ============================================================
 * Bezpečnostní povědomí a školení – § 10 vyhl. č. 409/2025 Sb. (vyhl. 410: § 5)
 *  - odst. 1–2: plán rozvoje bezpečnostního povědomí (forma, obsah, rozsah; vedení, uživatelé, administrátoři, bezpečnostní role, hesla),
 *  - odst. 3: vstupní a pravidelná poučení a školení, odborná školení bezpečnostních rolí, ověřování povědomí,
 *  - odst. 4: odpovědné osoby, provedení, hodnocení účinnosti,
 *  - odst. 5: přehledy o poučení a školení se seznamem osob.
 * ============================================================ */

export const COURSE_KINDS = ["induction", "periodic", "management", "professional", "verification"] as const;
export type CourseKind = (typeof COURSE_KINDS)[number];
export const COURSE_FORMS = ["classroom", "elearning", "webinar", "document", "exercise", "external"] as const;
export type CourseForm = (typeof COURSE_FORMS)[number];
export const SESSION_STATUSES = ["planned", "held", "cancelled"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const AWARENESS_LABELS = {
  kind: {
    induction: "Vstupní poučení / školení",
    periodic: "Pravidelné školení",
    management: "Poučení vrcholného vedení",
    professional: "Odborné školení",
    verification: "Ověřování povědomí (test, phishingová simulace)",
  } satisfies Record<CourseKind, string>,
  form: {
    classroom: "Prezenční",
    elearning: "E-learning",
    webinar: "Webinář",
    document: "Seznámení s dokumentem",
    exercise: "Praktické cvičení",
    external: "Externí kurz",
  } satisfies Record<CourseForm, string>,
  session: { planned: "Plánováno", held: "Proběhlo", cancelled: "Zrušeno" } satisfies Record<SessionStatus, string>,
  state: { ok: "Platné", due_soon: "Brzy vyprší", overdue: "Po termínu", missing: "Neabsolvováno" },
};

/** Návrhy témat (vlastní formulace) – ověřte proti příloze č. 6 vyhl. 409 / příloze č. 3 vyhl. 410. */
export const SUGGESTED_TOPICS = [
  "Bezpečnostní politika a povinnosti uživatelů",
  "Tvorba a ochrana hesel, vícefaktorové ověření (§ 19)",
  "Phishing a sociální inženýrství",
  "Hlášení podezřelých událostí a neobvyklého chování",
  "Bezpečné používání e-mailu a internetu",
  "Mobilní zařízení, práce na dálku a vzdálený přístup",
  "Klasifikace a ochrana informací, sdílení dat",
  "Fyzická bezpečnost a čistý stůl",
  "Ochrana osobních údajů",
  "Řízení rizik a kontinuity pro vedení",
];

const text = (max = 5000) => z.string().trim().max(max).nullable().optional();

export const CourseInput = z.object({
  companyId: z.string().uuid().optional(),
  code: z.string().trim().max(50).nullable().optional(),
  title: z.string().trim().min(1).max(300),
  kind: z.enum(COURSE_KINDS).default("periodic"),
  form: z.enum(COURSE_FORMS).default("elearning"),
  description: text(),
  topics: z.array(z.string().trim().min(1).max(200)).max(40).default([]),
  audience: Audience.default(EMPTY_AUDIENCE),
  /** Periodicita v měsících; null = jednorázové (např. vstupní). */
  intervalMonths: z.number().int().min(1).max(60).nullable().optional(),
  /** Lhůta pro nového zaměstnance (dny od nástupu do funkčního místa) – vstupní školení. */
  dueDaysForNew: z.number().int().min(1).max(365).nullable().optional(),
  durationHours: z.number().min(0).max(1000).nullable().optional(),
  /** § 10 odst. 4 písm. a) – odpovědná osoba. */
  ownerPositionId: z.string().uuid().nullable().optional(),
  /** Vazba na dokument, se kterým se školí (např. bezpečnostní politika). */
  policyId: z.string().uuid().nullable().optional(),
  active: z.boolean().default(true),
});
export type CourseInput = z.input<typeof CourseInput>;
export const CoursePatch = patchOf(CourseInput.omit({ companyId: true }));

export const SessionInput = z.object({
  date: z.string().date(),
  status: z.enum(SESSION_STATUSES).default("planned"),
  trainer: text(200),
  location: text(300),
  note: text(),
  /** § 10 odst. 4 písm. c) – hodnocení účinnosti. */
  effectiveness: text(),
  /** Účastníci (při stavu „proběhlo“ se zapíše absolvování). */
  participantIds: z.array(z.string().uuid()).max(5000).default([]),
});
export type SessionInput = z.input<typeof SessionInput>;
export const SessionPatch = patchOf(SessionInput);

export const RecordInput = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(5000),
  completedAt: z.string().date(),
  score: z.number().min(0).max(100).nullable().optional(),
  passed: z.boolean().default(true),
  note: text(1000),
});
export type RecordInput = z.input<typeof RecordInput>;

export type TrainingState = "ok" | "due_soon" | "overdue" | "missing";

export interface CourseListItem {
  id: string;
  companyId: string;
  code: string | null;
  title: string;
  kind: CourseKind;
  form: CourseForm;
  intervalMonths: number | null;
  ownerPositionName: string | null;
  active: boolean;
  /** Pokrytí dotčených osob. */
  stats: Record<TrainingState, number>;
  required: number;
  nextSession: string | null;
}

export interface CourseDetail extends CourseListItem {
  description: string | null;
  topics: string[];
  audience: Audience;
  dueDaysForNew: number | null;
  durationHours: number | null;
  ownerPositionId: string | null;
  policyId: string | null;
  policyTitle: string | null;
  sessions: { id: string; date: string; status: SessionStatus; trainer: string | null; location: string | null; note: string | null; effectiveness: string | null; participants: number }[];
  people: { userId: string; name: string; lastCompleted: string | null; validUntil: string | null; state: TrainingState }[];
  canEdit: boolean;
}

export interface MyTrainingItem {
  courseId: string;
  code: string | null;
  title: string;
  kind: CourseKind;
  form: CourseForm;
  lastCompleted: string | null;
  validUntil: string | null;
  state: TrainingState;
  nextSession: string | null;
}

/** Přehled poučení a školení (§ 10 odst. 5) – řádek. */
export interface TrainingLogRow {
  date: string;
  courseId: string;
  courseTitle: string;
  kind: CourseKind;
  userName: string;
  passed: boolean;
  score: number | null;
}

const addMonths = (d: string, m: number) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + m);
  return x.toISOString().slice(0, 10);
};
const addDays = (d: string, n: number) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/**
 * Stav školení osoby: platné / brzy vyprší (do 30 dnů) / po termínu / neabsolvováno.
 * U nového zaměstnance běží lhůta `dueDaysForNew` od nástupu (dříve je „missing“, ale ne „overdue“).
 */
export function trainingState(
  c: { intervalMonths: number | null; dueDaysForNew?: number | null },
  lastCompleted: string | null,
  today = new Date().toISOString().slice(0, 10),
  since?: string | null,
): { state: TrainingState; validUntil: string | null; dueDate: string | null } {
  if (!lastCompleted) {
    const due = since && c.dueDaysForNew ? addDays(since, c.dueDaysForNew) : null;
    return { state: due && due >= today ? "missing" : "overdue", validUntil: null, dueDate: due };
  }
  if (!c.intervalMonths) return { state: "ok", validUntil: null, dueDate: null };
  const validUntil = addMonths(lastCompleted, c.intervalMonths);
  if (validUntil < today) return { state: "overdue", validUntil, dueDate: validUntil };
  if (validUntil <= addDays(today, 30)) return { state: "due_soon", validUntil, dueDate: validUntil };
  return { state: "ok", validUntil, dueDate: validUntil };
}
