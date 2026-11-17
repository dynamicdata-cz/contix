import {
  REGISTRATION_FIELD_LABELS,
  RegistrationData,
  NUKIB_CHANGE_DAYS,
  NUKIB_NOTICE_DAYS,
  regulatedService,
  registrationChanges,
  registrationMissing,
  type RegimeLevel,
  type RegistrationDto,
  type RegistrationSnapshot,
  type RsResult,
} from "@contix/shared";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/client";
import { companies, regulationAssessments, regulationRegistrations } from "../../db/schema";

/* ============================================================
 * Ohlášení regulované služby NÚKIB (v1.63, ADR-157): podklad z posledního posouzení zapsaného do profilu
 * a doplněných údajů, stav ohlášení a změny k ohlášení. Nic se neodesílá – ohlášení podává uživatel na Portálu NÚKIB.
 * ============================================================ */

const addDays = (d: Date | string, n: number) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

async function lastApplied(db: Db, companyId: string) {
  const [a] = await db
    .select()
    .from(regulationAssessments)
    .where(and(eq(regulationAssessments.subjectKind, "company"), eq(regulationAssessments.subjectId, companyId), eq(regulationAssessments.applied, true)))
    .orderBy(desc(regulationAssessments.assessedAt))
    .limit(1);
  return a ?? null;
}

function snapshotOf(data: RegistrationData, regime: RegimeLevel | "none", services: string[]): RegistrationSnapshot {
  const { note: _n, responsiblePositionId: _p, ...rest } = data;
  return { data: rest, regime, services };
}

export async function registrationDto(db: Db, companyId: string): Promise<RegistrationDto | null> {
  const [co] = await db.select({ id: companies.id, name: companies.name, ico: companies.ico, address: companies.address, regime: companies.regime, pack: companies.pack }).from(companies).where(eq(companies.id, companyId));
  if (!co) return null;
  const [row] = await db.select().from(regulationRegistrations).where(eq(regulationRegistrations.companyId, companyId));
  const data = RegistrationData.parse({ ...(row?.data ?? {}), responsiblePositionId: row?.responsiblePositionId ?? null });
  const a = await lastApplied(db, companyId);
  const res = (a?.result as unknown as RsResult | undefined) ?? null;
  // režim je vždy z regulatorního profilu společnosti (jediný zdroj pravdy); posouzení dodává služby a upozorní na nesoulad (v1.65)
  const profile = co.pack === "cz" ? ((co.regime as RegimeLevel | "none" | null) ?? "none") : "none";
  const regime: RegimeLevel | "none" = profile === "higher" || profile === "lower" ? profile : "none";
  const services = regime === "none" ? [] : (res?.services ?? []).filter((s) => s.regime).map((s) => ({ code: s.code, name: regulatedService(s.code)?.name ?? s.code, regime: s.regime! }));
  const cur = snapshotOf(data, regime, services.map((s) => s.code));
  const prev = (row?.notifiedSnapshot as unknown as RegistrationSnapshot | null) ?? null;
  const changes = row?.notifiedAt ? registrationChanges(cur, prev).map((c) => ({ ...c, label: REGISTRATION_FIELD_LABELS[c.field] })) : [];
  let status: RegistrationDto["status"];
  let due: string | null = null;
  if (!row?.notifiedAt) {
    status = regime === "none" ? "not_required" : "to_notify";
    if (status === "to_notify" && a) due = addDays(a.assessedAt, NUKIB_NOTICE_DAYS);
  } else if (changes.length) {
    status = "changes_pending";
    due = addDays(row.changedAt ?? new Date(), NUKIB_CHANGE_DAYS);
  } else status = "notified";
  return {
    companyId,
    companyName: co.name,
    ico: co.ico,
    address: co.address,
    data,
    regime,
    services,
    assessedAt: a?.assessedAt.toISOString() ?? null,
    assessmentRegime: res ? res.regime : null,
    regimeMismatch: !!res && res.regime !== regime,
    status,
    notifiedAt: row?.notifiedAt ?? null,
    notifiedRef: row?.notifiedRef ?? null,
    changes,
    due,
    missing: regime === "none" ? [] : registrationMissing(data, co.ico),
  };
}

/** Po změně údajů nebo zápisu posouzení: počátek lhůty pro ohlášení změny (nebo její zrušení, když se údaje vrátily). */
export async function touchRegistration(db: Db, companyId: string, now = new Date()) {
  const [row] = await db.select().from(regulationRegistrations).where(eq(regulationRegistrations.companyId, companyId));
  if (!row?.notifiedAt) return;
  const d = await registrationDto(db, companyId);
  const changed = !!d?.changes.length;
  if (changed && !row.changedAt) await db.update(regulationRegistrations).set({ changedAt: now, updatedAt: now }).where(eq(regulationRegistrations.companyId, companyId));
  if (!changed && row.changedAt) await db.update(regulationRegistrations).set({ changedAt: null, updatedAt: now }).where(eq(regulationRegistrations.companyId, companyId));
}

export async function saveRegistration(db: Db, companyId: string, input: RegistrationData, now = new Date()) {
  const { responsiblePositionId, ...rest } = input;
  const data = rest as unknown as Record<string, unknown>;
  const pos = responsiblePositionId ?? null;
  await db
    .insert(regulationRegistrations)
    .values({ companyId, data, responsiblePositionId: pos, updatedAt: now })
    .onConflictDoUpdate({ target: regulationRegistrations.companyId, set: { data, responsiblePositionId: pos, updatedAt: now } });
  await touchRegistration(db, companyId, now);
}

/** Zaznamenat podané ohlášení: snímek aktuálních údajů = nový základ pro změny. */
export async function markNotified(db: Db, companyId: string, notifiedAt: string, notifiedRef: string, now = new Date()) {
  const d = await registrationDto(db, companyId);
  if (!d) return null;
  const snap = snapshotOf(d.data, d.regime, d.services.map((s) => s.code));
  await db
    .insert(regulationRegistrations)
    .values({ companyId, data: d.data as unknown as Record<string, unknown>, responsiblePositionId: d.data.responsiblePositionId, notifiedAt, notifiedRef: notifiedRef || null, notifiedSnapshot: snap as unknown as Record<string, unknown>, changedAt: null, updatedAt: now })
    .onConflictDoUpdate({ target: regulationRegistrations.companyId, set: { notifiedAt, notifiedRef: notifiedRef || null, notifiedSnapshot: snap as unknown as Record<string, unknown>, changedAt: null, updatedAt: now } });
  return registrationDto(db, companyId);
}

/** Povinnost „Ohlášení regulované služby NÚKIB“ – nové ohlášení nebo změna údajů s termínem. */
export async function nukibNoticeItems(db: Db, companyIds: string[]) {
  if (!companyIds.length) return [];
  const regs = await db.select({ companyId: regulationRegistrations.companyId, pos: regulationRegistrations.data }).from(regulationRegistrations).where(inArray(regulationRegistrations.companyId, companyIds));
  const applied = await db
    .selectDistinct({ companyId: regulationAssessments.subjectId })
    .from(regulationAssessments)
    .where(and(eq(regulationAssessments.subjectKind, "company"), eq(regulationAssessments.applied, true), inArray(regulationAssessments.subjectId, companyIds)));
  const ids = [...new Set([...regs.map((r) => r.companyId), ...applied.map((a) => a.companyId)])];
  const out: { companyId: string; status: "to_notify" | "changes_pending"; due: string | null; positionId: string | null; changes: number }[] = [];
  for (const id of ids) {
    const d = await registrationDto(db, id);
    if (!d || (d.status !== "to_notify" && d.status !== "changes_pending")) continue;
    out.push({ companyId: id, status: d.status, due: d.due, positionId: d.data.responsiblePositionId, changes: d.changes.length });
  }
  return out;
}

/** Podklad pro ohlášení (tisk / Word) – jen podmnožina HTML pro htmlToDocx. */
export function registrationHtml(d: RegistrationDto, esc: (s: string) => string): { title: string; body: string } {
  const title = `Podklad pro ohlášení regulované služby – ${d.companyName}`;
  const row = (k: string, v: string) => `<tr><td style="width:35%"><b>${esc(k)}</b></td><td>${v ? esc(v).replace(/\n/g, "<br>") : '<span class="muted">—</span>'}</td></tr>`;
  const reg = d.regime === "higher" ? "vyšší povinnosti (vyhl. 409/2025)" : d.regime === "lower" ? "nižší povinnosti (vyhl. 410/2025)" : "neregulovaná";
  const L = REGISTRATION_FIELD_LABELS;
  const parts = [
    `<h1>${esc(title)}</h1>`,
    `<p class="muted">Podklad pro vyplnění ohlášení na Portálu NÚKIB (§ 6 zákona č. 264/2025 Sb.). Každá regulovaná služba se ohlašuje zvlášť. Rozsah údajů ověřte v aktuálním formuláři portálu.</p>`,
    `<h2>Poskytovatel</h2>`,
    `<table>${row("Obchodní firma / název", d.companyName)}${row("IČO", d.ico ?? "")}${row("Sídlo", d.address ?? "")}${row(L.dataBox, d.data.dataBox)}${row(L.statutoryBody, d.data.statutoryBody)}${row(L.contactEmail, d.data.contactEmail)}${row(L.contactPhone, d.data.contactPhone)}</table>`,
    `<h2>Pověřená osoba pro kybernetickou bezpečnost</h2>`,
    `<table>${row("Jméno", d.data.kbName)}${row("Funkce", d.data.kbRole)}${row("E-mail", d.data.kbEmail)}${row("Telefon", d.data.kbPhone)}</table>`,
    `<h2>Regulované služby a režim</h2>`,
    `<p>Režim: <b>${esc(reg)}</b>${d.assessedAt ? ` · podle posouzení z ${esc(d.assessedAt.slice(0, 10))}` : ""}</p>`,
    d.services.length
      ? `<table><tr><th>Bod přílohy vyhl. 408/2025</th><th>Služba</th><th>Režim</th></tr>${d.services.map((s) => `<tr><td>${esc(s.code)}</td><td>${esc(s.name)}</td><td>${s.regime === "higher" ? "vyšší" : "nižší"}</td></tr>`).join("")}</table>`
      : `<p class="muted">Žádná regulovaná služba.</p>`,
    d.data.ipRanges || d.data.domains || d.data.memberStates ? `<h2>Doplňující údaje</h2><table>${row(L.ipRanges, d.data.ipRanges)}${row(L.domains, d.data.domains)}${row(L.memberStates, d.data.memberStates)}</table>` : "",
    d.changes.length
      ? `<h2>Změny k ohlášení</h2><p>Proti ohlášení ze dne ${esc(d.notifiedAt ?? "")}${d.due ? `; ohlaste do <b>${esc(d.due)}</b>` : ""}.</p><table><tr><th>Údaj</th><th>Dříve</th><th>Nyní</th></tr>${d.changes.map((c) => `<tr><td>${esc(c.label)}</td><td>${esc(c.before)}</td><td>${esc(c.after)}</td></tr>`).join("")}</table>`
      : "",
    d.missing.length ? `<p><b>Chybí:</b> ${esc(d.missing.join(", "))}</p>` : "",
    `<p class="small">Stav: ${esc(d.status === "notified" ? `ohlášeno ${d.notifiedAt ?? ""}${d.notifiedRef ? ` (${d.notifiedRef})` : ""}` : d.status === "to_notify" ? `k ohlášení${d.due ? ` do ${d.due}` : ""}` : d.status === "changes_pending" ? `změny k ohlášení${d.due ? ` do ${d.due}` : ""}` : "ohlášení není potřeba")}.</p>`,
  ];
  return { title, body: parts.filter(Boolean).join("\n") };
}
