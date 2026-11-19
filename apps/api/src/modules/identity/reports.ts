import {
  IDENTITY_INACTIVE_RULES,
  IDENTITY_LABELS,
  IDENTITY_REPORT_KINDS,
  IDENTITY_REPORT_LABELS,
  IDENTITY_RULE_INFO,
  IDENTITY_SEVERITIES,
  IdentityReportScheduleInput,
  ouOfDn,
  type IdentityReportGroup,
  type IdentityReportKind,
  type IdentityReportScheduleDto,
  type IdentityRule,
  type IdentitySeverity,
  type IdentitySourceStats,
  type Translate,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, eq, gte, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, requirePerm } from "../../auth/middleware";
import { inScope, settingsFor, soleCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { guideOwners, identityAccounts, identityFindings, identityReportSchedules, identitySnapshots, identitySources, positionHolders, positions, sodViolations, users } from "../../db/schema";
import { docxResponse, htmlToDocx } from "../documents/docx";
import { printPage } from "../documents/render";
import { tFor, translatorFor } from "../i18n/service";
import { convertToPdf } from "../policies/convert";
import { FindingQuery as IdentityFindingQuerySchema, findingWhere, type IdentityFindingQuery } from "./query";

/* ============================================================
 * Reporty identit z filtru (v1.89, ADR-184): neaktivní a nikdy nepřihlášené účty, privilegované účty, souhrn pro
 * vedení. Word (htmlToDocx), PDF tiskem stránky nebo převodní službou. Měsíční rozesílání garantovi modulu.
 * ============================================================ */

type Scope = (col: PgColumn) => SQL | undefined;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const day = (d: Date | string | null | undefined) => (d ? (typeof d === "string" ? d : d.toISOString()).slice(0, 10) : null);
const daysSince = (d: Date | null | undefined, now: Date) => (d ? Math.floor((now.getTime() - d.getTime()) / 86_400_000) : null);
const ruleTitle = (t: Translate, r: string) => t.lbl(IDENTITY_RULE_INFO[r as IdentityRule]?.title) ?? r;
const sevRank: Record<IdentitySeverity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export interface ReportCtx {
  db: Db;
  t: Translate;
  scope: Scope;
  q: IdentityFindingQuery;
  group: IdentityReportGroup;
  now: Date;
  organizationName: string;
}

/* ---------- data ---------- */

export async function inactiveData(x: ReportCtx) {
  const where = findingWhere({ ...x.q, rule: undefined }).concat(inArray(identityFindings.rule, x.q.rule && IDENTITY_INACTIVE_RULES.includes(x.q.rule) ? [x.q.rule] : IDENTITY_INACTIVE_RULES));
  const rows = await x.db
    .select({ f: identityFindings, a: identityAccounts, source: identitySources.name })
    .from(identityFindings)
    .innerJoin(identitySources, eq(identitySources.id, identityFindings.sourceId))
    .leftJoin(identityAccounts, eq(identityAccounts.id, identityFindings.accountId))
    .where(and(x.scope(identityFindings.companyId), ...where))
    .limit(20_000);
  const unitOf = (a: (typeof rows)[number]["a"]) => (x.group === "ou" ? ouOfDn(a?.dn) : (a?.department?.trim() || ouOfDn(a?.dn))) || x.t("srv.idr.noUnit");
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = unitOf(r.a);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const sorted = [...groups.entries()]
    .map(([unit, list]) => ({
      unit,
      privileged: list.filter((r) => r.a?.privileged).length,
      rows: list.sort((p, q) => Number(!!q.a?.privileged) - Number(!!p.a?.privileged) || (p.a?.lastLogonAt?.getTime() ?? 0) - (q.a?.lastLogonAt?.getTime() ?? 0) || (p.a?.login ?? "").localeCompare(q.a?.login ?? "")),
    }))
    .sort((p, q) => Number(q.privileged > 0) - Number(p.privileged > 0) || p.unit.localeCompare(q.unit, "cs"));
  return { groups: sorted, total: rows.length, privileged: rows.filter((r) => r.a?.privileged).length };
}

export async function privilegedData(x: ReportCtx) {
  const like = x.q.q ? `%${x.q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  const accs = await x.db
    .select({ a: identityAccounts, source: identitySources.name })
    .from(identityAccounts)
    .innerJoin(identitySources, eq(identitySources.id, identityAccounts.sourceId))
    .where(
      and(
        x.scope(identityAccounts.companyId),
        eq(identityAccounts.privileged, true),
        isNull(identityAccounts.removedAt),
        x.q.sourceId ? eq(identityAccounts.sourceId, x.q.sourceId) : undefined,
        like ? or(ilike(identityAccounts.login, like), ilike(identityAccounts.displayName, like)) : undefined,
      ),
    )
    .orderBy(asc(identityAccounts.login))
    .limit(5_000);
  const ids = accs.map((r) => r.a.id);
  const open = ids.length
    ? await x.db
        .select({ accountId: identityFindings.accountId, rule: identityFindings.rule, severity: identityFindings.severity })
        .from(identityFindings)
        .where(and(inArray(identityFindings.accountId, ids), eq(identityFindings.status, "open")))
    : [];
  const byAcc = new Map<string, { rule: string; severity: IdentitySeverity }[]>();
  for (const f of open) if (f.accountId) byAcc.set(f.accountId, [...(byAcc.get(f.accountId) ?? []), { rule: f.rule, severity: f.severity }]);
  const rows = accs
    .map((r) => ({ ...r, findings: byAcc.get(r.a.id) ?? [], pwdAge: daysSince(r.a.pwdLastSetAt, x.now) }))
    .sort((p, q) => q.findings.length - p.findings.length || (q.pwdAge ?? 99_999) - (p.pwdAge ?? 99_999));
  return { rows, enabled: rows.filter((r) => r.a.enabled).length, withSpn: rows.filter((r) => r.a.flags.hasSpn).length, delegation: rows.filter((r) => r.a.flags.unconstrainedDelegation).length };
}

export async function summaryData(x: ReportCtx) {
  const sc = and(x.scope(identityFindings.companyId), x.q.sourceId ? eq(identityFindings.sourceId, x.q.sourceId) : undefined);
  const since30 = new Date(x.now.getTime() - 30 * 86_400_000);
  const since = new Date(x.now.getFullYear(), x.now.getMonth() - 6, 1);
  const [byRule, [acc], [accepted], [resolved], top, snaps, [sod]] = await Promise.all([
    x.db
      .select({ rule: identityFindings.rule, severity: identityFindings.severity, n: count() })
      .from(identityFindings)
      .where(and(sc, eq(identityFindings.status, "open")))
      .groupBy(identityFindings.rule, identityFindings.severity),
    x.db
      .select({
        accounts: sql<number>`count(*) filter (where ${identityAccounts.enabled})`.mapWith(Number),
        privileged: sql<number>`count(*) filter (where ${identityAccounts.enabled} and ${identityAccounts.privileged})`.mapWith(Number),
      })
      .from(identityAccounts)
      .where(and(x.scope(identityAccounts.companyId), isNull(identityAccounts.removedAt), x.q.sourceId ? eq(identityAccounts.sourceId, x.q.sourceId) : undefined)),
    x.db.select({ n: count() }).from(identityFindings).where(and(sc, eq(identityFindings.status, "accepted"))),
    x.db.select({ n: count() }).from(identityFindings).where(and(sc, eq(identityFindings.status, "resolved"), gte(identityFindings.resolvedAt, since30))),
    x.db
      .select({ f: identityFindings, login: identityAccounts.login, privileged: identityAccounts.privileged })
      .from(identityFindings)
      .leftJoin(identityAccounts, eq(identityAccounts.id, identityFindings.accountId))
      .where(and(sc, eq(identityFindings.status, "open"), inArray(identityFindings.severity, ["critical", "high"])))
      .orderBy(sql`case ${identityFindings.severity} when 'critical' then 1 else 2 end`, sql`${identityAccounts.privileged} desc nulls last`, asc(identityFindings.firstSeenAt))
      .limit(10),
    x.db
      .select({ sourceId: identitySnapshots.sourceId, at: identitySnapshots.at, stats: identitySnapshots.stats })
      .from(identitySnapshots)
      .where(and(x.scope(identitySnapshots.companyId), gte(identitySnapshots.at, since), x.q.sourceId ? eq(identitySnapshots.sourceId, x.q.sourceId) : undefined))
      .orderBy(asc(identitySnapshots.at)),
    x.db.select({ n: count() }).from(sodViolations).where(and(x.scope(sodViolations.companyId), eq(sodViolations.status, "open"))),
  ]);
  const open = Object.fromEntries(IDENTITY_SEVERITIES.map((s) => [s, 0])) as Record<IdentitySeverity, number>;
  const rules = new Map<string, { n: number; worst: IdentitySeverity }>();
  for (const r of byRule) {
    open[r.severity] += r.n;
    const cur = rules.get(r.rule);
    rules.set(r.rule, { n: (cur?.n ?? 0) + r.n, worst: cur && sevRank[cur.worst] >= sevRank[r.severity] ? cur.worst : r.severity });
  }
  // trend: stav na konci každého měsíce (poslední snímek každého zdroje), posledních 6 měsíců + aktuální
  const months: { month: string; sev: Record<IdentitySeverity, number> }[] = [];
  const last = new Map<string, IdentitySourceStats>();
  let i = 0;
  for (let m = 6; m >= 0; m--) {
    const end = new Date(x.now.getFullYear(), x.now.getMonth() - m + 1, 1);
    while (i < snaps.length && snaps[i]!.at < end) {
      last.set(snaps[i]!.sourceId, snaps[i]!.stats);
      i++;
    }
    if (!last.size) continue;
    const sev = Object.fromEntries(IDENTITY_SEVERITIES.map((s) => [s, 0])) as Record<IdentitySeverity, number>;
    for (const st of last.values()) for (const s of IDENTITY_SEVERITIES) sev[s] += st.findings[s] ?? 0;
    const d = new Date(end.getTime() - 86_400_000);
    months.push({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, sev });
  }
  return {
    open,
    totalOpen: IDENTITY_SEVERITIES.reduce((a, s) => a + open[s], 0),
    accounts: acc?.accounts ?? 0,
    privileged: acc?.privileged ?? 0,
    accepted: accepted?.n ?? 0,
    resolved30: resolved?.n ?? 0,
    sodOpen: sod?.n ?? 0,
    rules: [...rules.entries()].map(([rule, v]) => ({ rule, ...v })).sort((p, q) => sevRank[q.worst] - sevRank[p.worst] || q.n - p.n),
    top: top.map((r) => ({ severity: r.f.severity, rule: r.f.rule, subject: r.login ?? r.f.subject.replace(/^group:/, ""), detail: r.f.detail, privileged: !!r.privileged, since: day(r.f.firstSeenAt) })),
    trend: months,
  };
}

/* ---------- vykreslení (HTML → tisk / PDF, Word) ---------- */

const table = (head: string[], rows: string[][]) =>
  `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${v}</td>`).join("")}</tr>`).join("")}</tbody></table>`;

function header(x: ReportCtx, kind: IdentityReportKind, sourceName: string | null) {
  const filter = [sourceName ? `${x.t("srv.idr.source")}: ${sourceName}` : null, x.q.q ? `${x.t("srv.idr.search")}: ${x.q.q}` : null, x.q.status && x.q.status !== "open" ? `${x.t("srv.idr.status")}: ${x.t.lbl(IDENTITY_LABELS.status[x.q.status])}` : null]
    .filter(Boolean)
    .join(" · ");
  return `<div class="muted small">${esc(x.organizationName)}</div><h1>${esc(x.t.lbl(IDENTITY_REPORT_LABELS[kind]))}</h1>
<p class="muted small">${esc(x.t("srv.idr.generated", { date: day(x.now) ?? "" }))}${filter ? ` · ${esc(filter)}` : ""}</p>`;
}

export async function renderIdentityReport(kind: IdentityReportKind, x: ReportCtx): Promise<{ title: string; body: string }> {
  const t = x.t;
  const title = t.lbl(IDENTITY_REPORT_LABELS[kind]);
  const [src] = x.q.sourceId ? await x.db.select({ name: identitySources.name }).from(identitySources).where(eq(identitySources.id, x.q.sourceId)) : [];
  let body = header(x, kind, src?.name ?? null);
  const yes = t("srv.idr.yes");
  const no = t("srv.idr.no");
  if (kind === "inactive") {
    const d = await inactiveData(x);
    body += `<p>${esc(t("srv.idr.inactiveIntro", { n: d.total, priv: d.privileged, groups: d.groups.length }))}</p>`;
    if (!d.total) body += `<p>${esc(t("srv.idr.none"))}</p>`;
    for (const g of d.groups) {
      body += `<h2>${esc(g.unit)} (${g.rows.length}${g.privileged ? ` · ${esc(t("srv.idr.privCount", { n: g.privileged }))}` : ""})</h2>`;
      body += table(
        [t("srv.idr.colAccount"), t("srv.idr.colKind"), t("srv.idr.colRule"), t("srv.idr.colLastLogon"), t("srv.idr.colCreated"), t("srv.idr.colPrivileged"), t("srv.idr.colDecision")],
        g.rows.map((r) => [
          `<b>${esc(r.a?.login ?? r.f.subject)}</b>${r.a?.displayName ? `<br>${esc(r.a.displayName)}` : ""}${r.a?.title ? `<br><span class="muted small">${esc(r.a.title)}</span>` : ""}`,
          esc(r.a ? t.lbl(IDENTITY_LABELS.accountKind[r.a.kind]) : ""),
          esc(ruleTitle(t, r.f.rule)),
          esc(day(r.a?.lastLogonAt) ?? t("srv.idr.never")),
          esc(day(r.a?.dirCreatedAt) ?? ""),
          r.a?.privileged ? `<b>${esc(yes)}</b>${r.a.privilegedVia.length ? `<br><span class="small">${esc(r.a.privilegedVia.join(", "))}</span>` : ""}` : esc(no),
          esc(t("srv.idr.decisionOptions")),
        ]),
      );
    }
    body += `<h2>${esc(t("srv.idr.signoff"))}</h2><p>${esc(t("srv.idr.signoffText"))}</p>`;
  } else if (kind === "privileged") {
    const d = await privilegedData(x);
    body += `<p>${esc(t("srv.idr.privIntro", { n: d.rows.length, enabled: d.enabled, spn: d.withSpn, deleg: d.delegation }))}</p>`;
    body += d.rows.length
      ? table(
          [t("srv.idr.colAccount"), t("srv.idr.colKind"), t("srv.idr.colGroups"), t("srv.idr.colPwdAge"), t("srv.idr.colLastLogon"), "SPN", t("srv.idr.colDelegation"), "MFA", t("srv.idr.colFindings")],
          d.rows.map((r) => [
            `<b>${esc(r.a.login)}</b>${r.a.displayName ? `<br>${esc(r.a.displayName)}` : ""}${r.a.enabled ? "" : `<br><span class="muted small">${esc(t("srv.idr.disabled"))}</span>`}`,
            esc(t.lbl(IDENTITY_LABELS.accountKind[r.a.kind])),
            esc(r.a.privilegedVia.join(", ")),
            esc(r.pwdAge === null ? "–" : t("srv.idr.days", { n: r.pwdAge })),
            esc(day(r.a.lastLogonAt) ?? t("srv.idr.never")),
            esc(r.a.flags.hasSpn ? yes : no),
            esc(r.a.flags.unconstrainedDelegation ? t("srv.idr.unconstrained") : no),
            esc(r.a.mfa === null ? "–" : r.a.mfa ? yes : no),
            esc(r.findings.map((f) => ruleTitle(t, f.rule)).join(", ") || "–"),
          ]),
        )
      : `<p>${esc(t("srv.idr.none"))}</p>`;
  } else {
    const d = await summaryData(x);
    body += `<h2>${esc(t("srv.idr.state"))}</h2>`;
    body += table(
      [t("srv.idr.metric"), t("srv.idr.value")],
      [
        [esc(t("srv.idr.accounts")), String(d.accounts)],
        [esc(t("srv.idr.privileged")), String(d.privileged)],
        [esc(t("srv.idr.openFindings")), `${d.totalOpen} (${IDENTITY_SEVERITIES.map((s) => `${esc(t.lbl(IDENTITY_LABELS.severity[s]))} ${d.open[s]}`).join(", ")})`],
        [esc(t("srv.idr.accepted")), String(d.accepted)],
        [esc(t("srv.idr.resolved30")), String(d.resolved30)],
        [esc(t("srv.idr.sod")), String(d.sodOpen)],
      ],
    );
    body += `<h2>${esc(t("srv.idr.byRule"))}</h2>`;
    body += d.rules.length
      ? table([t("srv.idr.colRule"), t("srv.idr.colSeverity"), t("srv.idr.colOpen")], d.rules.map((r) => [esc(ruleTitle(t, r.rule)), esc(t.lbl(IDENTITY_LABELS.severity[r.worst])), String(r.n)]))
      : `<p>${esc(t("srv.idr.none"))}</p>`;
    body += `<h2>${esc(t("srv.idr.trend"))}</h2>`;
    body += d.trend.length
      ? table(
          [t("srv.idr.month"), ...IDENTITY_SEVERITIES.map((s) => t.lbl(IDENTITY_LABELS.severity[s])), t("srv.idr.total")],
          d.trend.map((m) => [m.month, ...IDENTITY_SEVERITIES.map((s) => String(m.sev[s])), `<b>${IDENTITY_SEVERITIES.reduce((a, s) => a + m.sev[s], 0)}</b>`]),
        )
      : `<p>${esc(t("srv.idr.noTrend"))}</p>`;
    body += `<h2>${esc(t("srv.idr.top"))}</h2>`;
    body += d.top.length
      ? table(
          [t("srv.idr.colSeverity"), t("srv.idr.colRule"), t("srv.idr.colAccount"), t("srv.idr.colDetail"), t("srv.idr.colSince")],
          d.top.map((r) => [esc(t.lbl(IDENTITY_LABELS.severity[r.severity])), esc(ruleTitle(t, r.rule)), `${esc(r.subject)}${r.privileged ? ` <b>(${esc(t("srv.idr.privShort"))})</b>` : ""}`, esc(r.detail), esc(r.since ?? "")]),
        )
      : `<p>${esc(t("srv.idr.none"))}</p>`;
  }
  return { title, body };
}

export async function identityReportFile(kind: IdentityReportKind, x: ReportCtx, format: "docx" | "pdf" | "html", config?: Config): Promise<{ buf: Uint8Array; filename: string; contentType: string; title: string }> {
  const { title, body } = await renderIdentityReport(kind, x);
  const base = `identity-${kind}-${day(x.now)}`;
  if (format === "html") return { buf: new TextEncoder().encode(printPage(title, body, x.t.locale)), filename: `${base}.html`, contentType: "text/html; charset=utf-8", title };
  const docx = await htmlToDocx(printPage(title, body, x.t.locale), { title, headerLine: x.organizationName, landscape: kind !== "summary" });
  if (format === "pdf" && config?.CONVERTER_URL) {
    const pdf = await convertToPdf(new Uint8Array(docx), `${base}.docx`);
    return { buf: pdf, filename: `${base}.pdf`, contentType: "application/pdf", title };
  }
  return { buf: new Uint8Array(docx), filename: `${base}.docx`, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", title };
}

/* ---------- plán měsíčního rozesílání ---------- */

/** Příjemci = držitelé funkčního místa garanta průvodce „identity“ ve společnosti (aktivní uživatelé s e-mailem). */
export async function identityGuarantor(db: Db, companyId: string) {
  const [g] = await db
    .select({ positionId: guideOwners.positionId, name: positions.name })
    .from(guideOwners)
    .innerJoin(positions, eq(positions.id, guideOwners.positionId))
    .where(and(eq(guideOwners.companyId, companyId), eq(guideOwners.guideId, "identity")));
  if (!g) return null;
  const rec = await db
    .select({ email: users.email, locale: users.locale })
    .from(positionHolders)
    .innerJoin(users, eq(users.id, positionHolders.userId))
    .where(and(eq(positionHolders.positionId, g.positionId), eq(users.isActive, true)));
  return { ...g, recipients: rec.filter((r) => !!r.email) };
}

async function scheduleDto(db: Db, config: Config, companyId: string): Promise<IdentityReportScheduleDto> {
  const [row] = await db.select().from(identityReportSchedules).where(eq(identityReportSchedules.companyId, companyId));
  const g = await identityGuarantor(db, companyId);
  return {
    companyId,
    enabled: row?.enabled ?? false,
    reports: (row?.reports ?? ["summary"]).filter((k): k is IdentityReportKind => (IDENTITY_REPORT_KINDS as readonly string[]).includes(k)),
    format: row?.format === "pdf" ? "pdf" : "docx",
    day: row?.day ?? 1,
    group: row?.group === "ou" ? "ou" : "department",
    lastSentAt: row?.lastSentAt?.toISOString() ?? null,
    lastStatus: row?.lastStatus ?? null,
    guarantor: g ? { positionId: g.positionId, name: g.name, recipients: g.recipients.length } : null,
    pdfAvailable: !!config.CONVERTER_URL,
  };
}

export interface ReportMailer {
  send(m: { to: string; subject: string; html: string; text: string; attachments?: { filename: string; content: Buffer; contentType: string }[] }): Promise<void>;
}

/** Odeslání reportů garantovi jedné společnosti (plán nebo „odeslat teď“). */
export async function sendIdentityReports(db: Db, config: Config, mailer: ReportMailer, companyId: string, now = new Date()): Promise<{ sent: number; status: string }> {
  const plan = await scheduleDto(db, config, companyId);
  const g = await identityGuarantor(db, companyId);
  if (!g?.recipients.length) {
    const status = g ? "Garant modulu nemá držitele s e-mailem." : "Garant modulu Identity a přístupy není určen.";
    await db.insert(identityReportSchedules).values({ companyId, lastStatus: status }).onConflictDoUpdate({ target: identityReportSchedules.companyId, set: { lastStatus: status } });
    return { sent: 0, status };
  }
  const orgName = (await settingsFor(db, null, companyId)).organizationName;
  const scope: Scope = (col) => eq(col, companyId);
  let sent = 0;
  for (const r of g.recipients) {
    const t = await translatorFor(db, r.locale ?? "cs");
    const x: ReportCtx = { db, t, scope, q: {}, group: plan.group, now, organizationName: orgName };
    const files = [];
    for (const kind of plan.reports) files.push(await identityReportFile(kind, x, plan.format, config));
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const list = files.map((f) => `<li>${esc(f.title)}</li>`).join("");
    await mailer.send({
      to: r.email!,
      subject: t("srv.idr.mailSubject", { month }),
      html: `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1e293b"><p>${esc(t("srv.idr.mailIntro", { position: g.name }))}</p><ul>${list}</ul><p style="color:#64748b">${esc(t("srv.idr.mailFoot"))}</p></div>`,
      text: `${t("srv.idr.mailIntro", { position: g.name })}\n${files.map((f) => `- ${f.title}`).join("\n")}`,
      attachments: files.map((f) => ({ filename: f.filename, content: Buffer.from(f.buf), contentType: f.contentType })),
    });
    sent++;
  }
  const status = `Odesláno ${sent} příjemcům (${plan.reports.length} reportů).`;
  await db
    .insert(identityReportSchedules)
    .values({ companyId, lastSentAt: now, lastStatus: status })
    .onConflictDoUpdate({ target: identityReportSchedules.companyId, set: { lastSentAt: now, lastStatus: status } });
  return { sent, status };
}

/** Plánovač: jednou za měsíc od nastaveného dne (zapnuté plány); opakování v témže měsíci hlídá lastSentAt. */
export async function processIdentityReports(db: Db, config: Config, mailer: ReportMailer, now = new Date()) {
  const plans = await db.select().from(identityReportSchedules).where(eq(identityReportSchedules.enabled, true));
  let sent = 0;
  for (const p of plans) {
    if (now.getDate() < p.day) continue;
    if (p.lastSentAt && p.lastSentAt.getFullYear() === now.getFullYear() && p.lastSentAt.getMonth() === now.getMonth()) continue;
    try {
      sent += (await sendIdentityReports(db, config, mailer, p.companyId, now)).sent;
    } catch (e) {
      await db.update(identityReportSchedules).set({ lastStatus: `Chyba: ${(e as Error).message}`.slice(0, 500) }).where(eq(identityReportSchedules.companyId, p.companyId));
    }
  }
  return sent;
}

/* ---------- API /api/identity/reports ---------- */

const ReportQuery = IdentityFindingQuerySchema.extend({ group: z.enum(["department", "ou"]).default("department"), lang: z.string().max(10).optional() });
const KindParam = z.object({ kind: z.enum(IDENTITY_REPORT_KINDS) });

export function identityReportRoutes(db: Db, config: Config) {
  const ctx = async (c: Context<AppEnv>, q: z.infer<typeof ReportQuery>): Promise<ReportCtx> => {
    const t = q.lang ? await translatorFor(db, q.lang) : await tFor(db, c);
    const scope: Scope = (col) => inScope(c, col);
    return { db, t, scope, q, group: q.group, now: new Date(), organizationName: (await settingsFor(db, c)).organizationName };
  };
  return new Hono<AppEnv>()
    .get("/schedule", requirePerm("identity:read"), async (c) => c.json(await scheduleDto(db, config, soleCompany(c))))
    .put("/schedule", requirePerm("identity:write"), zValidator("json", IdentityReportScheduleInput), async (c) => {
      const i = c.req.valid("json");
      const companyId = soleCompany(c);
      const set = { enabled: i.enabled, reports: [...new Set(i.reports)], format: i.format, day: i.day, group: i.group, updatedById: currentUser(c).id, updatedAt: new Date() };
      await db.insert(identityReportSchedules).values({ companyId, ...set }).onConflictDoUpdate({ target: identityReportSchedules.companyId, set });
      await audit(db, { c, user: currentUser(c), action: "identity.report_schedule_saved", entityType: "identity", details: set });
      return c.json(await scheduleDto(db, config, companyId));
    })
    .post("/schedule/send", requirePerm("identity:write"), async (c) => {
      const { notificationMailer } = await import("../notifications/service");
      const mailer = await notificationMailer(db, config);
      if (!mailer) throw new HTTPException(409, { message: "Odesílání e-mailů není nastavené (Nastavení → Upozornění)." });
      const r = await sendIdentityReports(db, config, mailer, soleCompany(c));
      await audit(db, { c, user: currentUser(c), action: "identity.report_sent", entityType: "identity", details: r });
      return c.json(r);
    })
    .get("/:kind{(inactive|privileged|summary)\\.(html|docx|pdf)}", requirePerm("identity:read"), zValidator("query", ReportQuery), async (c) => {
      const [kind, format] = c.req.param("kind").split(".") as [IdentityReportKind, "html" | "docx" | "pdf"];
      KindParam.parse({ kind });
      const x = await ctx(c, c.req.valid("query"));
      if (format === "pdf" && !config.CONVERTER_URL) throw new HTTPException(409, { message: "Převodní služba pro PDF není nastavená – použijte tisk stránky do PDF." });
      const f = await identityReportFile(kind, x, format, config);
      await audit(db, { c, user: currentUser(c), action: "identity.report_exported", entityType: "identity", details: { kind, format } });
      if (format === "html") return c.html(new TextDecoder().decode(f.buf), 200, { "cache-control": "private, no-store" });
      if (format === "docx") return docxResponse(Buffer.from(f.buf), f.filename);
      return new Response(new Uint8Array(f.buf), { headers: { "content-type": f.contentType, "content-disposition": `attachment; filename="${f.filename}"`, "cache-control": "private, no-store" } });
    });
}
