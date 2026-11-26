import { z } from "zod";
import type { ObligationKind, ObligationUrgency } from "./notifications";

/* ============================================================
 * Kalendář zákonných lhůt a přehled „Tento týden“ (v1.98, ADR-192).
 * Položky kalendáře jsou povinnosti (Moje práce / tým) s termínem + periodické provozní lhůty (test obnovy).
 * ============================================================ */

/** Právní základ lhůty – podle něj se filtruje „jen zákonné lhůty“. */
export const DEADLINE_BASES = ["zkb", "measures", "gdpr", "aiact", "cra", "internal"] as const;
export type DeadlineBasis = (typeof DEADLINE_BASES)[number];

export const DEADLINE_BASIS_LABELS: Record<DeadlineBasis, string> = {
  zkb: "Zákon o kybernetické bezpečnosti",
  measures: "Vyhláška o bezpečnostních opatřeních",
  gdpr: "GDPR",
  aiact: "AI Act",
  cra: "Cyber Resilience Act (CRA)",
  internal: "Interní termín",
};

export type CalendarKind = ObligationKind | "restore_test";

/** Druh lhůty → právní základ. Co tu není, je interní termín. */
const BASIS: Partial<Record<CalendarKind, DeadlineBasis>> = {
  incident_report: "zkb",
  nukib_notice: "zkb",
  info_assessment: "zkb",
  isms_review: "measures",
  risk_review: "measures",
  assessment_cycle: "measures",
  policy_review: "measures",
  audit: "measures",
  plan_test: "measures",
  exercise: "measures",
  access_review: "measures",
  access_certification: "measures",
  control_test: "measures",
  change: "measures",
  contract: "measures",
  supplier_report: "measures",
  supplier_questionnaire: "measures",
  supplier_qualification: "measures",
  restore_test: "measures",
  processing_review: "gdpr",
  ai_review: "aiact",
  cra_report: "cra",
  cra_support: "cra",
};
export const deadlineBasis = (k: CalendarKind): DeadlineBasis => BASIS[k] ?? "internal";

export interface CalendarItemDto {
  key: string;
  kind: CalendarKind;
  basis: DeadlineBasis;
  title: string;
  detail: string | null;
  /** Datum (YYYY-MM-DD) nebo okamžik ISO (hlášení incidentu). */
  due: string;
  urgency: ObligationUrgency;
  link: string;
  companyId: string | null;
  ownerName: string | null;
}

export interface CalendarDto {
  from: string;
  to: string;
  /** Položky v období + vše po termínu (seřazeno podle termínu). */
  items: CalendarItemDto[];
}

/** Pondělí až neděle týdne, do kterého patří datum (UTC, YYYY-MM-DD). */
export function weekRange(now = new Date()): { from: string; to: string } {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7; // 0 = pondělí
  const from = new Date(d.getTime() - dow * 86400_000);
  const to = new Date(from.getTime() + 6 * 86400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/* ---------- export do kalendáře (iCalendar, RFC 5545) ---------- */

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Zalomení řádku po 75 oktetech (UTF-8), pokračování začíná mezerou. */
export function icsFold(line: string): string {
  const out: string[] = [];
  let cur = "";
  let len = 0;
  for (const ch of line) {
    const cp = ch.codePointAt(0) ?? 0;
    const n = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (len + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      len = 0;
    }
    cur += ch;
    len += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const ymd = (d: string) => d.slice(0, 10).replace(/-/g, "");
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export interface IcsOptions {
  appUrl: string;
  calendarName: string;
  /** Popisky (přeložené) právních základů. */
  basisLabel: (b: DeadlineBasis) => string;
  /** Upozornění N dní předem u zákonných lhůt (0 = bez upozornění). */
  alarmDays?: number;
  now?: Date;
}

export function buildIcs(items: CalendarItemDto[], o: IcsOptions): string {
  const now = o.now ?? new Date();
  const base = o.appUrl.replace(/\/+$/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CONTIX//Kalendar lhut//CS", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${esc(o.calendarName)}`];
  for (const i of items) {
    const url = `${base}${i.link}`;
    lines.push("BEGIN:VEVENT", `UID:${esc(i.key)}@contix`, `DTSTAMP:${stamp(now)}`);
    if (i.due.length > 10) {
      const start = new Date(i.due);
      lines.push(`DTSTART:${stamp(start)}`, `DTEND:${stamp(new Date(start.getTime() + 30 * 60_000))}`);
    } else {
      const next = new Date(`${i.due.slice(0, 10)}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${ymd(i.due)}`, `DTEND;VALUE=DATE:${ymd(next.toISOString())}`, "TRANSP:TRANSPARENT");
    }
    const desc = [o.basisLabel(i.basis), i.detail, i.ownerName, url].filter(Boolean).join("\n");
    lines.push(`SUMMARY:${esc(i.title)}`, `DESCRIPTION:${esc(desc)}`, `URL:${esc(url)}`, `CATEGORIES:${esc(o.basisLabel(i.basis))}`);
    if (o.alarmDays && i.basis !== "internal" && i.due.length <= 10)
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(i.title)}`, `TRIGGER:-P${o.alarmDays}D`, "END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(icsFold).join("\r\n") + "\r\n";
}


/* ---------- odběr kalendáře adresou (v1.101, ADR-195) ---------- */

export const CALENDAR_FEED_PREFIX = "cal_";
export const CalendarFeedInput = z.object({
  name: z.string().trim().min(1).max(120).default("CONTIX – lhůty"),
  /** null = všechny společnosti, ke kterým má uživatel přístup. */
  companyId: z.string().uuid().nullable().optional(),
  legalOnly: z.boolean().default(true),
});
export type CalendarFeedInput = z.input<typeof CalendarFeedInput>;

export interface CalendarFeedDto {
  id: string;
  name: string;
  companyId: string | null;
  companyName: string | null;
  legalOnly: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}
