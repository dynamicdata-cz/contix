import { processDefectDojo } from "../vulnerabilities/defectdojo";
import { processMonitors } from "../controls/monitors";
import { processInfoService } from "../infoservice/routes";
import { processScenarioRefresh } from "../risks/scenarios";
import { processKriRefresh } from "../risks/appetite";
import { processLegislationSync } from "../legislation/service";
import { OBLIGATION_LABELS, URGENCY_LABELS, type NotificationSettingsDto, type NotificationSettingsInput, type ObligationItem, type Permission, type Translate } from "@contix/shared";
import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { processTrendSnapshots, pruneTrendSnapshots } from "../trends/service";
import { processRecordIndex } from "../search/records";
import { decrypt, encrypt } from "../../auth/crypto";
import { getCompanies, permissionsByCompany } from "../../auth/scope";
import { getSettings } from "../../auth/service";
import { appSecret, type Config } from "../../config";
import type { Db } from "../../db/client";
import { appSettings, notificationLog, users } from "../../db/schema";
import { syncAlerts } from "../alerts/routes";
import { refreshExposure } from "../soc/exposure";
import { processPreTriage } from "../soc/triage";
import { notifyNewAlerts } from "../soc/response";
import { processThreatIntel } from "../soc/threatIntel";
import { processHunts } from "../soc/hunts";
import { processPullSources } from "../soc/pull";
import { maybeSyncSca, processScaAutomations } from "../sca/service";
import { processTlsScans } from "../assets/certificates";
import { processNetScans } from "../discovery/segments";
import { maybeRefreshVulnIntel } from "../vulnerabilities/intel";
import { maybeRefreshOsv } from "../cra/osv";
import { autoWazuhSync } from "../discovery/wazuhSync";
import { processPendingFiles } from "../policies/convert";
import { processDocIndex } from "../policies/qa";
import { processIdentitySync } from "../identity/service";
import { acquireLease, recordSchedulerRun } from "../ops/lease";
import { collectObligations, kindsForModules, personalObligations } from "./obligations";
import { CS_T, translatorFor } from "../i18n/service";

/* ============================================================
 * Upozornění na lhůty: denní souhrn (osobní e-mail + souhrn pro bezpečnostní tým, Teams)
 * a okamžité výstrahy u lhůt hlášení incidentů (24 h / 72 h).
 * ============================================================ */

const KEY = "notifications";

interface Stored {
  emailEnabled: boolean;
  smtpHost: string | null;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string | null;
  smtpPasswordEnc: string | null;
  smtpFrom: string | null;
  teamsEnabled: boolean;
  teamsWebhookEnc: string | null;
  digestHour: number;
  leadDays: number;
  weekdaysOnly: boolean;
  lastRunAt: string | null;
  lastResult: string | null;
  lastDigestDay: string | null;
}

const DEFAULTS: Stored = {
  emailEnabled: false,
  smtpHost: null,
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: null,
  smtpPasswordEnc: null,
  smtpFrom: null,
  teamsEnabled: false,
  teamsWebhookEnc: null,
  digestHour: 7,
  leadDays: 14,
  weekdaysOnly: true,
  lastRunAt: null,
  lastResult: null,
  lastDigestDay: null,
};

async function load(db: Db): Promise<Stored> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, KEY));
  return { ...DEFAULTS, ...((row?.value as Partial<Stored>) ?? {}) };
}
async function store(db: Db, v: Stored) {
  await db
    .insert(appSettings)
    .values({ key: KEY, value: v })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: v, updatedAt: new Date() } });
}

export const toDto = (s: Stored): NotificationSettingsDto => ({
  emailEnabled: s.emailEnabled,
  smtpHost: s.smtpHost,
  smtpPort: s.smtpPort,
  smtpSecure: s.smtpSecure,
  smtpUser: s.smtpUser,
  smtpPasswordSet: !!s.smtpPasswordEnc,
  smtpFrom: s.smtpFrom,
  teamsEnabled: s.teamsEnabled,
  teamsWebhookSet: !!s.teamsWebhookEnc,
  digestHour: s.digestHour,
  leadDays: s.leadDays,
  weekdaysOnly: s.weekdaysOnly,
  lastRunAt: s.lastRunAt,
  lastResult: s.lastResult,
});

export async function getNotificationSettings(db: Db) {
  return load(db);
}

/** Teams webhook musí být HTTPS na doméně Microsoftu (Workflows / Power Automate / příchozí webhook). */
export function validTeamsUrl(u: string): boolean {
  try {
    const x = new URL(u);
    return x.protocol === "https:" && /(^|\.)(office\.com|office365\.com|logic\.azure\.com|powerautomate\.com|powerplatform\.com|microsoft\.com)$/i.test(x.hostname);
  } catch {
    return false;
  }
}

export async function saveNotificationSettings(db: Db, config: Config, input: NotificationSettingsInput) {
  const cur = await load(db);
  const { smtpPassword, teamsWebhookUrl, ...rest } = input;
  const next: Stored = { ...cur, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) };
  if (smtpPassword !== undefined) next.smtpPasswordEnc = smtpPassword ? encrypt(smtpPassword, appSecret(config)) : null;
  if (teamsWebhookUrl !== undefined) {
    if (teamsWebhookUrl && !validTeamsUrl(teamsWebhookUrl)) throw new Error("Adresa Teams webhooku musí být HTTPS adresa služeb Microsoftu (Workflows / příchozí webhook).");
    next.teamsWebhookEnc = teamsWebhookUrl ? encrypt(teamsWebhookUrl, appSecret(config)) : null;
  }
  if (next.emailEnabled && (!next.smtpHost || !next.smtpFrom)) throw new Error("Pro e-mail vyplňte SMTP server a adresu odesílatele.");
  if (next.teamsEnabled && !next.teamsWebhookEnc) throw new Error("Pro Teams vyplňte adresu webhooku.");
  await store(db, next);
  return next;
}

const dec = (v: string | null, config: Config) => {
  try {
    return v ? decrypt(v, appSecret(config)) : null;
  } catch {
    return null;
  }
};

/* ---------------- kanály ---------------- */

export interface Mailer {
  send(m: { to: string; subject: string; html: string; text: string }): Promise<void>;
}
export interface TeamsPoster {
  post(url: string, payload: unknown): Promise<void>;
}

export function smtpMailer(s: Stored, config: Config): Mailer {
  const t = nodemailer.createTransport({
    host: s.smtpHost!,
    port: s.smtpPort,
    secure: s.smtpSecure,
    auth: s.smtpUser ? { user: s.smtpUser, pass: dec(s.smtpPasswordEnc, config) ?? "" } : undefined,
    connectionTimeout: 15_000,
  });
  return { send: async (m) => void (await t.sendMail({ from: s.smtpFrom!, ...m })) };
}

export const fetchTeams: TeamsPoster = {
  async post(url, payload) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`Teams odpověděl ${r.status}`);
  },
};

/* ---------------- obsah ---------------- */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmtDue = (d: string | null, t: Translate = CS_T) => (d ? new Date(d.length <= 10 ? `${d}T12:00:00` : d).toLocaleString(t.locale === "cs" ? "cs-CZ" : t.locale, d.length <= 10 ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" }) : "—");

export function renderDigest(items: ObligationItem[], appUrl: string, title: string, companies: Map<string, string>, t: Translate = CS_T) {
  const groups = (["overdue", "today", "soon"] as const).map((u) => [u, items.filter((i) => i.urgency === u)] as const).filter(([, l]) => l.length);
  const multi = new Set(items.map((i) => i.companyId)).size > 1;
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1e293b">
<h2 style="margin:0 0 4px">${esc(title)}</h2><p style="color:#64748b;margin:0 0 16px">${esc(t("srv.mail.intro"))}</p>
${groups
  .map(
    ([u, l]) => `<h3 style="margin:16px 0 6px;color:${u === "overdue" ? "#b91c1c" : u === "today" ? "#c2410c" : "#334155"}">${esc(t.lbl(URGENCY_LABELS[u]))} (${l.length})</h3>
<table cellpadding="6" style="border-collapse:collapse;width:100%">${l
      .map(
        (i) => `<tr style="border-top:1px solid #e2e8f0"><td style="white-space:nowrap;color:#64748b;width:110px">${esc(fmtDue(i.due, t))}</td>
<td><a href="${esc(appUrl + i.link)}" style="color:#1d4ed8;text-decoration:none">${esc(i.title)}</a><br><span style="color:#64748b;font-size:12px">${esc(t.lbl(OBLIGATION_LABELS[i.kind]))}${i.detail ? ` · ${esc(i.detail)}` : ""}${i.ownerName ? ` · ${esc(i.ownerName)}` : ""}${multi ? ` · ${esc(companies.get(i.companyId) ?? "")}` : ""}</span></td></tr>`,
      )
      .join("")}</table>`,
  )
  .join("")}
<p style="color:#94a3b8;font-size:12px;margin-top:20px">${esc(t("srv.mail.footer"))}</p></div>`;
  const text = groups.map(([u, l]) => `${t.lbl(URGENCY_LABELS[u])}:\n${l.map((i) => `- ${fmtDue(i.due, t)} ${i.title} (${t.lbl(OBLIGATION_LABELS[i.kind])}) ${appUrl}${i.link}`).join("\n")}`).join("\n\n");
  return { html, text };
}

/** Karta pro Teams (Adaptive Card přes Workflows i klasický webhook). */
export function teamsCard(items: ObligationItem[], appUrl: string, title: string, companies: Map<string, string>, t: Translate = CS_T) {
  const multi = new Set(items.map((i) => i.companyId)).size > 1;
  const body: unknown[] = [{ type: "TextBlock", size: "Medium", weight: "Bolder", text: title, wrap: true }];
  for (const u of ["overdue", "today", "soon"] as const) {
    const l = items.filter((i) => i.urgency === u);
    if (!l.length) continue;
    body.push({ type: "TextBlock", weight: "Bolder", text: `${t.lbl(URGENCY_LABELS[u])} (${l.length})`, color: u === "overdue" ? "Attention" : u === "today" ? "Warning" : "Default", spacing: "Medium" });
    for (const i of l.slice(0, 25))
      body.push({
        type: "TextBlock",
        wrap: true,
        spacing: "Small",
        text: `${fmtDue(i.due, t)} – [${i.title.replace(/[[\]]/g, "")}](${appUrl}${i.link}) · ${t.lbl(OBLIGATION_LABELS[i.kind])}${i.ownerName ? ` · ${i.ownerName}` : ""}${multi ? ` · ${companies.get(i.companyId) ?? ""}` : ""}`,
      });
    if (l.length > 25) body.push({ type: "TextBlock", text: t("srv.mail.more", { n: l.length - 25 }), isSubtle: true });
  }
  return {
    type: "message",
    attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4", body } }],
  };
}

/* ---------------- běh ---------------- */

export interface RunDeps {
  db: Db;
  config: Config;
  mailer?: Mailer;
  teams?: TeamsPoster;
  now?: Date;
  /** Vynutit denní souhrn (tlačítko „Odeslat nyní“, testy). */
  forceDigest?: boolean;
}

async function once(db: Db, key: string, channel: string, recipient: string, urgency: string, send: () => Promise<void>): Promise<boolean> {
  const [row] = await db.insert(notificationLog).values({ key, channel, recipient, urgency }).onConflictDoNothing().returning({ id: notificationLog.id });
  if (!row) return false; // už odesláno
  try {
    await send();
    return true;
  } catch (e) {
    // při chybě záznam smazat, aby se příště zkusilo znovu
    await db.delete(notificationLog).where(eq(notificationLog.id, row.id));
    throw e;
  }
}

/** Uživatelé s oprávněním `isms:write` ve společnosti = bezpečnostní tým pro týmový souhrn (SOC: `soc:write`). */
async function securityTeam(db: Db, companyIds: string[], perm: Permission = "isms:write") {
  const us = await db.select({ id: users.id, email: users.email, name: users.displayName, locale: users.locale }).from(users).where(eq(users.isActive, true));
  const out: { email: string; name: string; locale: string | null; companies: string[] }[] = [];
  for (const u of us) {
    const { by } = await permissionsByCompany(db, u.id);
    const cos = companyIds.filter((c) => by.get(c)?.has(perm));
    if (cos.length) out.push({ email: u.email, name: u.name, locale: u.locale, companies: cos });
  }
  return out;
}

/** Okamžité upozornění SOC (ADR-055): nový závažný alert, zásah ke schválení, selhaný zásah. Text v jazyce příjemce. */
export interface SocNotice {
  /** Klíč pro odstranění duplicit (notification_log). */
  key: string;
  companyId: string;
  /** Komu: uživatelé s tímto oprávněním ve společnosti. */
  perm: Permission;
  title: (t: Translate) => string;
  lines: (t: Translate) => string[];
  link: string;
}

export async function sendSocNotices(d: { db: Db; config: Config; mailer?: Mailer; teams?: TeamsPoster }, notices: SocNotice[]): Promise<{ emails: number; teams: number; errors: string[] }> {
  const { db, config } = d;
  const result = { emails: 0, teams: 0, errors: [] as string[] };
  if (!notices.length) return result;
  const s = await load(db);
  if (!s.emailEnabled && !s.teamsEnabled) return result;
  const mailer = s.emailEnabled ? (d.mailer ?? smtpMailer(s, config)) : null;
  const teams = s.teamsEnabled ? (d.teams ?? fetchTeams) : null;
  const teamsUrl = dec(s.teamsWebhookEnc, config);
  const appUrl = config.APP_URL.replace(/\/+$/, "");
  const defLocale = (await getSettings(db)).defaultLocale ?? "cs";
  const tr = new Map<string, Promise<Translate>>();
  const tFor = (l: string | null) => {
    const k = l ?? defLocale;
    if (!tr.has(k)) tr.set(k, translatorFor(db, k));
    return tr.get(k)!;
  };
  const companyIds = [...new Set(notices.map((n) => n.companyId))];
  const teamsBy = new Map<Permission, Awaited<ReturnType<typeof securityTeam>>>();
  for (const n of notices) {
    if (!teamsBy.has(n.perm)) teamsBy.set(n.perm, await securityTeam(db, companyIds, n.perm));
    const url = `${appUrl}${n.link}`;
    if (mailer)
      for (const r of teamsBy.get(n.perm)!.filter((x) => x.companies.includes(n.companyId))) {
        const t = await tFor(r.locale);
        const title = n.title(t);
        const lines = n.lines(t);
        const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1e293b"><h2 style="margin:0 0 8px">${esc(title)}</h2>${lines.map((l) => `<p style="margin:0 0 4px">${esc(l)}</p>`).join("")}<p style="margin:12px 0 0"><a href="${esc(url)}" style="color:#1d4ed8">${esc(t("srv.soc.open"))}</a></p><p style="color:#94a3b8;font-size:12px;margin-top:20px">${esc(t("srv.mail.footer"))}</p></div>`;
        const text = `${title}\n\n${lines.join("\n")}\n\n${url}`;
        try {
          if (await once(db, n.key, "email", r.email, "soc", () => mailer.send({ to: r.email, subject: `[CONTIX SOC] ${title}`, html, text }))) result.emails++;
        } catch (e) {
          result.errors.push(`e-mail ${r.email}: ${(e as Error).message}`);
        }
      }
    if (teams && teamsUrl) {
      const t = await tFor(defLocale);
      const body = [{ type: "TextBlock", size: "Medium", weight: "Bolder", text: n.title(t), wrap: true, color: "Attention" }, ...n.lines(t).map((l) => ({ type: "TextBlock", text: l, wrap: true, spacing: "Small" })), { type: "TextBlock", text: `[${t("srv.soc.open")}](${url})`, spacing: "Medium" }];
      const card = { type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4", body } }] };
      try {
        if (await once(db, n.key, "teams", "teams", "soc", () => teams.post(teamsUrl, card))) result.teams++;
      } catch (e) {
        result.errors.push(`Teams: ${(e as Error).message}`);
      }
    }
  }
  return result;
}

export async function runNotifications(d: RunDeps): Promise<{ emails: number; teams: number; errors: string[] }> {
  const { db, config } = d;
  const now = d.now ?? new Date();
  const s = await load(db);
  const result = { emails: 0, teams: 0, errors: [] as string[] };
  if (!s.emailEnabled && !s.teamsEnabled) return result;
  const base = await getSettings(db);
  const cos = (await getCompanies(db)).filter((c) => c.active);
  const names = new Map(cos.map((c) => [c.id, c.name]));
  const companyIds = cos.map((c) => c.id);
  const kinds = kindsForModules(base.enabledModules);
  // texty povinností v jazyce příjemce (uživatel → výchozí jazyk organizace); Teams kanál ve výchozím jazyce
  const defLocale = base.defaultLocale ?? "cs";
  const byLocale = new Map<string, Promise<{ t: Translate; all: ObligationItem[] }>>();
  const forLocale = (loc: string | null | undefined) => {
    const l = loc ?? defLocale;
    let p = byLocale.get(l);
    if (!p) {
      p = translatorFor(db, l).then(async (t) => ({ t, all: await collectObligations(db, { companyIds, leadDays: s.leadDays, now, kinds, t }) }));
      byLocale.set(l, p);
    }
    return p;
  };
  const { t: tDef, all } = await forLocale(defLocale);
  const mailer = s.emailEnabled ? (d.mailer ?? smtpMailer(s, config)) : null;
  const teams = s.teamsEnabled ? (d.teams ?? fetchTeams) : null;
  const teamsUrl = dec(s.teamsWebhookEnc, config);
  const appUrl = config.APP_URL.replace(/\/+$/, "");
  const guard = async (what: string, f: () => Promise<boolean>, count: "emails" | "teams") => {
    try {
      if (await f()) result[count]++;
    } catch (e) {
      result.errors.push(`${what}: ${(e as Error).message}`);
    }
  };

  // 1) okamžité výstrahy – lhůty hlášení incidentů (dnes / po termínu)
  const urgent = all.filter((i) => i.kind === "incident_report" && (i.urgency === "today" || i.urgency === "overdue"));
  if (urgent.length) {
    const team = await securityTeam(db, companyIds);
    for (const i of urgent) {
      const titleIn = (t: Translate, x: ObligationItem) => t(x.urgency === "overdue" ? "srv.mail.overdueTitle" : "srv.mail.runningTitle", { title: x.title });
      if (mailer)
        for (const r of team.filter((tm) => tm.companies.includes(i.companyId))) {
          const L = await forLocale(r.locale);
          const li = L.all.find((x) => x.key === i.key) ?? i;
          const title = titleIn(L.t, li);
          const m = renderDigest([li], appUrl, title, names, L.t);
          await guard(`e-mail ${r.email}`, () => once(db, i.key, "email", r.email, i.urgency, () => mailer.send({ to: r.email, subject: `[CONTIX] ${title}`, ...m })), "emails");
        }
      if (teams && teamsUrl) await guard("Teams", () => once(db, i.key, "teams", "teams", i.urgency, () => teams.post(teamsUrl, teamsCard([i], appUrl, titleIn(tDef, i), names, tDef))), "teams");
    }
  }

  // 1b) lhůty SOC po termínu (převzetí / vyřešení) – okamžitě analytikům SOC (ADR-047)
  const socLate = all.filter((i) => i.kind === "soc_sla" && i.urgency === "overdue");
  if (socLate.length) {
    const team = await securityTeam(db, companyIds, "soc:write");
    for (const i of socLate) {
      const titleIn = (t: Translate, x: ObligationItem) => t("srv.mail.socLateTitle", { title: x.title, what: x.detail ?? "" });
      if (mailer)
        for (const r of team.filter((tm) => tm.companies.includes(i.companyId))) {
          const L = await forLocale(r.locale);
          const li = L.all.find((x) => x.key === i.key) ?? i;
          const title = titleIn(L.t, li);
          const m = renderDigest([li], appUrl, title, names, L.t);
          await guard(`e-mail ${r.email}`, () => once(db, i.key, "email", r.email, i.urgency, () => mailer.send({ to: r.email, subject: `[CONTIX SOC] ${title}`, ...m })), "emails");
        }
      if (teams && teamsUrl) await guard("Teams", () => once(db, i.key, "teams", "teams", i.urgency, () => teams.post(teamsUrl, teamsCard([i], appUrl, titleIn(tDef, i), names, tDef))), "teams");
    }
  }

  // 2) denní souhrn v nastavenou hodinu
  const day = now.toISOString().slice(0, 10);
  const weekday = now.getDay() !== 0 && now.getDay() !== 6;
  const dueDigest = d.forceDigest || (now.getHours() >= s.digestHour && s.lastDigestDay !== day && (!s.weekdaysOnly || weekday));
  if (dueDigest) {
    const key = `digest:${day}${d.forceDigest ? `:${now.getTime()}` : ""}`;
    // týmový souhrn: bezpečnostní tým (e-mail) a kanál Teams
    const team = await securityTeam(db, companyIds);
    if (mailer)
      for (const r of team) {
        const L = await forLocale(r.locale);
        const items = L.all.filter((i) => r.companies.includes(i.companyId));
        if (!items.length) continue;
        const m = renderDigest(items, appUrl, L.t("srv.mail.teamTitle"), names, L.t);
        await guard(`e-mail ${r.email}`, () => once(db, `${key}:team`, "email", r.email, "digest", () => mailer.send({ to: r.email, subject: L.t("srv.mail.teamSubject", { n: items.length }), ...m })), "emails");
      }
    if (teams && teamsUrl && all.length)
      await guard("Teams", () => once(db, key, "teams", "teams", "digest", () => teams.post(teamsUrl, teamsCard(all, appUrl, tDef("srv.mail.teamsTitle", { n: all.length }), names, tDef))), "teams");
    // osobní souhrny: vlastníci (funkční místa), seznámení, školení
    if (mailer) {
      const us = await db.select({ id: users.id, email: users.email, locale: users.locale }).from(users).where(eq(users.isActive, true));
      const teamMails = new Set(team.map((t) => t.email));
      for (const u of us) {
        const L = await forLocale(u.locale);
        const items = (await personalObligations(db, u.id, s.leadDays, base.enabledModules, now, false, L.t)).filter((i) => i.urgency !== "later");
        // členové týmu dostali týmový souhrn – osobní jen s položkami navíc (seznámení, školení)
        const mine = teamMails.has(u.email) ? items.filter((i) => i.kind === "policy_ack" || i.kind === "training") : items;
        if (!mine.length) continue;
        const m = renderDigest(mine, appUrl, L.t("srv.mail.mineTitle"), names, L.t);
        await guard(`e-mail ${u.email}`, () => once(db, `${key}:me`, "email", u.email, "digest", () => mailer.send({ to: u.email, subject: L.t("srv.mail.mineSubject", { n: mine.length }), ...m })), "emails");
      }
    }
    s.lastDigestDay = day;
  }
  s.lastRunAt = now.toISOString();
  s.lastResult = result.errors.length ? tDef("srv.mail.lastResultErrors", { errors: result.errors.slice(0, 3).join("; ") }) : tDef("srv.mail.lastResultOk", { emails: result.emails, teams: result.teams });
  // uložit jen stavové položky (nastavení mohl mezitím někdo změnit)
  const fresh = await load(db);
  await store(db, { ...fresh, lastRunAt: s.lastRunAt, lastResult: s.lastResult, lastDigestDay: s.lastDigestDay });
  return result;
}

/** Plánovač: kontrola každých 15 minut (výstrahy incidentů, denní souhrn). */
export function startNotificationScheduler(db: Db, config: Config, intervalMs = 15 * 60_000) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    let error: string | null = null;
    try {
      // při více instancích API spouští úlohy jen držitel lease (ADR-016)
      if (!(await acquireLease(db, "scheduler", intervalMs * 2 + 60_000))) return;
      // nejdřív Wazuh alerty (nové návrhy událostí), pak upozornění
      await syncAlerts(db, config).catch((e) => {
        error = `Wazuh alerty: ${(e as Error).message}`;
        console.error(error);
      });
      // alerty × zranitelnosti (ADR-048): přepočet expozice otevřených alertů
      if (((await getSettings(db)).enabledModules as string[]).includes("soc")) {
        await refreshExposure(db).catch((e) => console.error("Expozice alertů SOC:", (e as Error).message));
        // veřejné zdroje IOC (ADR-057): stažení podle intervalu, hledání v nových alertech Wazuhu
        await processThreatIntel({ db, config }).catch((e) => console.error("Zdroje hrozeb:", (e as Error).message));
        // plánované hledání hrozeb (ADR-059)
        await processHunts({ db, config }).catch((e) => console.error("Hledání hrozeb:", (e as Error).message));
        // stahování ze SIEM – Microsoft Sentinel, Elastic Security (ADR-062)
        await processPullSources({ db, config }).catch((e) => console.error("Stahování ze SIEM:", (e as Error).message));
        // okamžité upozornění na nové závažné alerty (ADR-055)
        await notifyNewAlerts({ db, config }).catch((e) => console.error("Upozornění SOC:", (e as Error).message));
        // AI předběžná triáž nových alertů (ADR-051) – na pozadí, lokální model může odpovídat desítky sekund
        void processPreTriage(db, config).catch((e) => console.error("AI triáž SOC:", (e as Error).message));
      }
      // shoda konfigurace – Wazuh SCA jednou denně, pak automatické testy opatření (ADR-064) – na pozadí
      if (((await getSettings(db)).enabledModules as string[]).includes("assets"))
        void maybeSyncSca(db, config)
          .then(() => processScaAutomations(db))
          .catch((e) => console.error("Wazuh SCA:", (e as Error).message));
      // průběžné monitorování opatření (ADR-096) – na pozadí, Secure Score volá Microsoft Graph
      void processMonitors(db, config).catch((e) => console.error("Monitorování opatření:", (e as Error).message));
      // kontrola certifikátů a TLS jednou denně (ADR-070) – na pozadí
      if (((await getSettings(db)).enabledModules as string[]).includes("assets")) void processTlsScans(db).catch((e) => console.error("Kontrola TLS:", (e as Error).message));
      // plánované skeny síťových segmentů (ADR-072) – na pozadí, sken může trvat dlouho
      void processNetScans(db, config).catch((e) => console.error("Skeny segmentů:", (e as Error).message));
      // informační servis regulátora – RSS NÚKIB a otevřená data o incidentech (ADR-087) – na pozadí
      if (((await getSettings(db)).enabledModules as string[]).includes("legislation"))
        void processInfoService(db).catch((e) => console.error("Informační servis:", (e as Error).message));
      // veřejné zdroje hrozeb (CISA KEV, EPSS) jednou denně – na pozadí, stahování nesmí blokovat plánovač
      if (((await getSettings(db)).enabledModules as string[]).includes("vulnerabilities"))
        void maybeRefreshVulnIntel(db).catch((e) => console.error("KEV / EPSS:", (e as Error).message));
      // rizikové scénáře z dat – denní obnova návrhů a podnětů k přehodnocení (v1.18, ADR-115) – na pozadí
      if (((await getSettings(db)).enabledModules as string[]).includes("risks"))
        void processScenarioRefresh(db)
          .then(() => processKriRefresh(db))
          .catch((e) => console.error("Rizikové scénáře z dat / KRI:", (e as Error).message));
      // konektor DefectDojo (ADR-097) – jen čtení, podle intervalu, na pozadí
      void processDefectDojo(db, config);
      // offline databáze OSV pro komponenty produktů (CRA, ADR-093) jednou denně – na pozadí
      if (((await getSettings(db)).enabledModules as string[]).includes("cra")) void maybeRefreshOsv(db).catch((e) => console.error("OSV:", (e as Error).message));
      // automatická synchronizace aktiv a zranitelností z Wazuhu (běží na pozadí, nečeká se na ni)
      await autoWazuhSync(db, config).catch((e) => {
        error = `Wazuh synchronizace: ${(e as Error).message}`;
        console.error(error);
      });
      // převody souborů dokumentace (PDF, text) – dávka s časovým limitem
      await processPendingFiles(db, Math.min(5 * 60_000, intervalMs / 3)).catch((e) => {
        error = `Převody dokumentů: ${(e as Error).message}`;
        console.error(error);
      });
      // index „Zeptej se dokumentace“ (nové platné verze, texty z převodní služby, změna modelu)
      await processDocIndex(db, config, Math.min(5 * 60_000, intervalMs / 3)).catch((e) => {
        error = `Indexace dokumentace: ${(e as Error).message}`;
        console.error(error);
      });
      // vektorový index záznamů (rizika, zranitelnosti, incidenty, výjimky) – ADR-044
      await processRecordIndex(db, config, Math.min(5 * 60_000, intervalMs / 3)).catch((e) => {
        error = `Indexace záznamů: ${(e as Error).message}`;
        console.error(error);
      });
      // kontroly účtů v AD / Entra ID (zdroje, kterým uplynul interval synchronizace)
      await processIdentitySync(db, config).then((errs) => {
        if (errs.length) {
          error = `Identity: ${errs.join("; ")}`;
          console.error(error);
        }
      });
      // legislativa – nová znění sledovaných předpisů z e-Sbírky (jednou denně)
      await processLegislationSync(db, config).then((errs) => {
        if (errs.length) {
          error = `Legislativa: ${errs.join("; ")}`;
          console.error(error);
        }
      });
      // trendy – měsíční snímek ukazatelů každé společnosti (obnova po 12 h, ADR-042)
      await processTrendSnapshots(db).then((errs) => {
        if (errs.length) {
          error = `Trendy: ${errs.join("; ")}`;
          console.error(error);
        }
      });
      await pruneTrendSnapshots(db).catch(() => {});
      await runNotifications({ db, config });
      await recordSchedulerRun(db, error);
    } catch (e) {
      console.error("Upozornění:", (e as Error).message);
      await recordSchedulerRun(db, `Upozornění: ${(e as Error).message}`).catch(() => {});
    } finally {
      running = false;
    }
  };
  const h = setInterval(tick, intervalMs);
  setTimeout(tick, 30_000);
  return () => clearInterval(h);
}

export async function testChannel(db: Db, config: Config, channel: "email" | "teams", to: string | undefined, deps: { mailer?: Mailer; teams?: TeamsPoster } = {}, t: Translate = CS_T) {
  const s = await load(db);
  if (channel === "email") {
    if (!s.smtpHost || !s.smtpFrom) throw new Error("Vyplňte a uložte SMTP server a odesílatele.");
    if (!to) throw new Error("Zadejte adresu příjemce.");
    await (deps.mailer ?? smtpMailer(s, config)).send({ to, subject: t("srv.mail.testSubject"), text: t("srv.mail.testBody"), html: `<p>${esc(t("srv.mail.testBody"))}</p>` });
    return t("srv.mail.testSent", { to });
  }
  const url = dec(s.teamsWebhookEnc, config);
  if (!url) throw new Error("Vyplňte a uložte adresu Teams webhooku.");
  await (deps.teams ?? fetchTeams).post(url, teamsCard([], config.APP_URL, t("srv.mail.testTeamsCard"), new Map(), t));
  return t("srv.mail.testTeamsSent");
}

