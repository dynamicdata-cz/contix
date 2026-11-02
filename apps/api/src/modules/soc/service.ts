import {
  ATTACK_TACTICS,
  ROOT_COMPANY_ID,
  SOC_CASE_OPEN,
  SOC_OPEN_STATUSES,
  SOC_SETTINGS_DEFAULTS,
  caseSeverity,
  socSeverity,
  socSla,
  suppressionMatches,
  tacticsFor,
  type ObligationItem,
  type SocCaseDto,
  type SocSettings,
  type SocSla,
  type SocVerdict,
  type Translate,
  urgencyOf,
  effectiveLevel,
} from "@contix/shared";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { alertSuggestions, appSettings, incidents, socCases, socSuppressions, users } from "../../db/schema";
import { CS_T } from "../i18n/service";

import { effLevelSql } from "./exposure";

/* ============================================================
 * SOC II (ADR-047): nastavení lhůt, potlačení, korelace alertů do případů, lhůty SLA.
 * Závažnost případu a lhůty se počítají při čtení (caseSeverity, socSla) – nepersistují se.
 * ============================================================ */

const KEY = "soc.settings";

export async function getSocSettings(db: Db): Promise<SocSettings> {
  const [r] = await db.select().from(appSettings).where(eq(appSettings.key, KEY));
  const v = (r?.value ?? {}) as Partial<SocSettings>;
  return {
    ...SOC_SETTINGS_DEFAULTS,
    ...v,
    ackMinutes: { ...SOC_SETTINGS_DEFAULTS.ackMinutes, ...(v.ackMinutes ?? {}) },
    resolveHours: { ...SOC_SETTINGS_DEFAULTS.resolveHours, ...(v.resolveHours ?? {}) },
  };
}
export async function saveSocSettings(db: Db, v: SocSettings) {
  await db
    .insert(appSettings)
    .values({ key: KEY, value: v })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: v, updatedAt: new Date() } });
}

/* ---------- potlačení ---------- */

export type ActiveSuppression = typeof socSuppressions.$inferSelect;

/** Platná pravidla potlačení (nezrušená, s platností do dneška včetně). */
export async function activeSuppressions(db: Db, now = new Date()): Promise<ActiveSuppression[]> {
  const today = now.toISOString().slice(0, 10);
  return db
    .select()
    .from(socSuppressions)
    .where(and(isNull(socSuppressions.revokedAt), gte(socSuppressions.until, today)));
}

/** Najde pravidlo potlačení pro skupinu alertů; připíše zásahy. */
export async function suppressGroup(db: Db, list: ActiveSuppression[], g: { companyId: string | null; ruleId: string; agentId: string | null; srcip: string | null; n: number; last: Date }): Promise<boolean> {
  const company = g.companyId ?? ROOT_COMPANY_ID;
  const hit = list.find((s) => s.companyId === company && suppressionMatches(s, g));
  if (!hit) return false;
  await db
    .update(socSuppressions)
    .set({ hits: sql`${socSuppressions.hits} + ${g.n}`, lastHitAt: g.last, updatedAt: new Date() })
    .where(eq(socSuppressions.id, hit.id));
  return true;
}

/* ---------- korelace do případů ---------- */

type AlertRow = typeof alertSuggestions.$inferSelect;
const srcipOf = (a: Pick<AlertRow, "sample">) => {
  const ip = (a.sample as Record<string, unknown> | null)?.srcip;
  return typeof ip === "string" && ip ? ip : null;
};
/** Klíče korelace alertu: hostitel (agent nebo aktivum) a zdrojová IP. */
export function correlationKeys(a: Pick<AlertRow, "agentId" | "assetId" | "sample">): string[] {
  const out: string[] = [];
  if (a.agentId) out.push(`host:${a.agentId}`);
  else if (a.assetId) out.push(`asset:${a.assetId}`);
  const ip = srcipOf(a);
  if (ip) out.push(`ip:${ip}`);
  return out;
}

/**
 * Automatické spojování otevřených alertů bez případu: připojit k otevřenému případu se stejným hostitelem / IP
 * (aktivita v okně korelace), jinak ze ≥ 2 alertů se stejným klíčem založit nový případ. Vrací počet dotčených alertů.
 */
export async function correlateAlerts(db: Db, now = new Date()): Promise<number> {
  const s = await getSocSettings(db);
  if (!s.autoCases) return 0;
  const since = new Date(now.getTime() - s.correlationHours * 3600_000);
  const loose = await db
    .select()
    .from(alertSuggestions)
    .where(and(inArray(alertSuggestions.status, [...SOC_OPEN_STATUSES]), isNull(alertSuggestions.caseId), gte(alertSuggestions.lastSeen, since)));
  if (!loose.length) return 0;
  const openCases = await db.select().from(socCases).where(inArray(socCases.status, [...SOC_CASE_OPEN]));
  const members = openCases.length
    ? await db
        .select()
        .from(alertSuggestions)
        .where(inArray(alertSuggestions.caseId, openCases.map((c) => c.id)))
    : [];
  // klíč (společnost|klíč) → otevřený případ s aktivitou v okně
  const caseByKey = new Map<string, string>();
  for (const c of openCases) {
    const ms = members.filter((m) => m.caseId === c.id);
    if (!ms.some((m) => m.lastSeen >= since)) continue;
    for (const m of ms) for (const k of correlationKeys(m)) caseByKey.set(`${c.companyId}|${k}`, c.id);
  }
  let touched = 0;
  const rest: AlertRow[] = [];
  for (const a of loose) {
    const cid = correlationKeys(a)
      .map((k) => caseByKey.get(`${a.companyId}|${k}`))
      .find(Boolean);
    if (cid) {
      await db.update(alertSuggestions).set({ caseId: cid, updatedAt: new Date() }).where(eq(alertSuggestions.id, a.id));
      touched++;
    } else rest.push(a);
  }
  // nové případy – nejdřív podle hostitele, pak podle IP
  const done = new Set<string>();
  for (const kind of ["host:", "asset:", "ip:"]) {
    const groups = new Map<string, AlertRow[]>();
    for (const a of rest) {
      if (done.has(a.id)) continue;
      const k = correlationKeys(a).find((x) => x.startsWith(kind));
      if (!k) continue;
      const gk = `${a.companyId}|${k}`;
      groups.set(gk, [...(groups.get(gk) ?? []), a]);
    }
    for (const [gk, list] of groups) {
      if (list.length < 2) continue;
      const key = gk.split("|")[1]!;
      const first = list[0]!;
      const label = key.startsWith("ip:") ? `zdrojová IP ${key.slice(3)}` : `hostitel ${first.agentName ?? key.split(":")[1]}`;
      const [c] = await db
        .insert(socCases)
        .values({ companyId: first.companyId, title: `Související alerty – ${label}`.slice(0, 300), description: `Případ založen automaticky korelací ${list.length} alertů (${label}).`, auto: true, correlationKey: key })
        .returning();
      await db.update(alertSuggestions).set({ caseId: c!.id, updatedAt: new Date() }).where(inArray(alertSuggestions.id, list.map((a) => a.id)));
      for (const a of list) done.add(a.id);
      touched += list.length;
    }
  }
  return touched;
}

/* ---------- DTO případů ---------- */

export const caseCode = (seq: number) => `SOC-${seq}`;

export async function caseDtos(db: Db, rows: (typeof socCases.$inferSelect)[], settings: SocSettings, now = new Date()): Promise<SocCaseDto[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [alerts, people, incs] = await Promise.all([
    db
      .select({ caseId: alertSuggestions.caseId, level: effLevelSql, status: alertSuggestions.status, mitre: alertSuggestions.mitreIds, tactics: alertSuggestions.mitreTactics, agentName: alertSuggestions.agentName, sample: alertSuggestions.sample, first: alertSuggestions.firstSeen, last: alertSuggestions.lastSeen })
      .from(alertSuggestions)
      .where(inArray(alertSuggestions.caseId, ids)),
    db
      .select({ id: users.id, n: users.displayName })
      .from(users)
      .where(inArray(users.id, [...new Set(rows.map((r) => r.assigneeId).filter((x): x is string => !!x))].concat(["00000000-0000-0000-0000-000000000000"]))),
    db
      .select({ id: incidents.id, title: incidents.title })
      .from(incidents)
      .where(inArray(incidents.id, [...new Set(rows.map((r) => r.incidentId).filter((x): x is string => !!x))].concat(["00000000-0000-0000-0000-000000000000"]))),
  ]);
  const names = new Map(people.map((p) => [p.id, p.n]));
  const incTitle = new Map(incs.map((i) => [i.id, i.title]));
  return rows.map((r) => {
    const as = alerts.filter((a) => a.caseId === r.id);
    const mitreIds = [...new Set(as.flatMap((a) => a.mitre))];
    const tset = new Set([...tacticsFor(mitreIds, []), ...as.flatMap((a) => a.tactics)]);
    const mitreTactics = ATTACK_TACTICS.map((x) => x.id).filter((id) => tset.has(id));
    const sev = caseSeverity(
      as.map((a) => socSeverity(a.level)),
      as.map((a) => a.tactics),
    );
    const firsts = as.map((a) => a.first.getTime());
    const lasts = as.map((a) => a.last.getTime());
    return {
      id: r.id,
      code: caseCode(r.seq),
      companyId: r.companyId,
      title: r.title,
      description: r.description,
      status: r.status as SocCaseDto["status"],
      severity: sev.severity,
      baseSeverity: sev.base,
      chain: sev.chain,
      auto: r.auto,
      assigneeId: r.assigneeId,
      assigneeName: r.assigneeId ? (names.get(r.assigneeId) ?? null) : null,
      alertCount: as.length,
      openAlerts: as.filter((a) => (SOC_OPEN_STATUSES as readonly string[]).includes(a.status)).length,
      mitreIds,
      mitreTactics,
      hosts: [...new Set(as.map((a) => a.agentName).filter((x): x is string => !!x))],
      srcips: [...new Set(as.map((a) => srcipOf(a)).filter((x): x is string => !!x))],
      firstSeen: firsts.length ? new Date(Math.min(...firsts)).toISOString() : null,
      lastSeen: lasts.length ? new Date(Math.max(...lasts)).toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
      closedAt: r.closedAt?.toISOString() ?? null,
      verdict: (r.verdict as SocVerdict | null) ?? null,
      closeReason: r.closeReason,
      incidentId: r.incidentId,
      incidentTitle: r.incidentId ? (incTitle.get(r.incidentId) ?? null) : null,
      sla: socSla(sev.severity, r.createdAt, r.acknowledgedAt, r.closedAt, settings, now),
    };
  });
}

/** Lhůty alertu mimo případ. */
export const alertSla = (a: Pick<AlertRow, "caseId" | "ruleLevel" | "exposure" | "createdAt" | "acknowledgedAt" | "decidedAt">, s: SocSettings, now = new Date()): SocSla | null =>
  a.caseId ? null : socSla(socSeverity(effectiveLevel(a.ruleLevel, a.exposure)), a.createdAt, a.acknowledgedAt, a.decidedAt, s, now);

/* ---------- povinnosti (lhůty SLA) ---------- */

export interface SocSlaItem extends Omit<ObligationItem, "urgency"> {
  urgency: ObligationItem["urgency"];
  assigneeId: string | null;
}

/** Otevřené alerty (mimo případ) a případy s běžící lhůtou – převzetí, nebo po převzetí vyřešení. */
export async function socSlaItems(db: Db, companyIds: string[], leadDays: number, now = new Date(), t: Translate = CS_T): Promise<SocSlaItem[]> {
  if (!companyIds.length) return [];
  const s = await getSocSettings(db);
  const [alerts, cases] = await Promise.all([
    db
      .select()
      .from(alertSuggestions)
      .where(and(inArray(alertSuggestions.companyId, companyIds), inArray(alertSuggestions.status, [...SOC_OPEN_STATUSES]), isNull(alertSuggestions.caseId))),
    db
      .select()
      .from(socCases)
      .where(and(inArray(socCases.companyId, companyIds), inArray(socCases.status, [...SOC_CASE_OPEN]))),
  ]);
  const out: SocSlaItem[] = [];
  const push = (id: string, what: "alert" | "case", title: string, companyId: string, sla: SocSla, acked: boolean, assigneeId: string | null, link: string) => {
    const stage = acked ? "resolve" : "ack";
    const due = acked ? sla.resolveDue : sla.ackDue;
    const urgency = (acked ? sla.resolve : sla.ack) === "breached" ? "overdue" : urgencyOf(due, leadDays, now);
    if (urgency === "later") return;
    out.push({ key: `soc_sla:${what}:${id}:${stage}`, kind: "soc_sla", title, detail: t(acked ? "srv.obl.socResolve" : "srv.obl.socAck"), companyId, due, urgency, link, ownerPositionId: null, ownerName: null, assigneeId });
  };
  for (const a of alerts) push(a.id, "alert", a.title ?? a.description, a.companyId, alertSla(a, s, now)!, !!a.acknowledgedAt, a.assigneeId, `/soc/${a.id}`);
  for (const c of await caseDtos(db, cases, s, now)) {
    const row = cases.find((x) => x.id === c.id)!;
    push(c.id, "case", `${c.code} ${c.title}`, c.companyId, c.sla, !!row.acknowledgedAt, row.assigneeId, `/soc/cases/${c.id}`);
  }
  return out;
}
