import {
  ControlMonitorInput,
  EntraSourceConfig,
  MONITOR_FREQ_HOURS,
  MONITOR_LABELS,
  MONITOR_SPEC,
  MonitorPeriodTestInput,
  MonitorPushInput,
  evaluateMonitor,
  monitorParamsOf,
  monitorPeriod,
  type ControlMonitorDto,
  type ControlMonitorKind,
  type MonitorParams,
  type MonitorResult,
  type MonitorRunDto,
  type Permission,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { createHash, randomBytes } from "node:crypto";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, inScope } from "../../auth/scope";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import {
  assetSources,
  assets,
  assetVulnerabilities,
  controlMonitorRuns,
  controlMonitors,
  controls,
  controlTests,
  controlTestSamples,
  evidence,
  evidenceControls,
  evidenceFiles,
  identityAccounts,
  identityFindings,
  identitySources,
  policies,
  scaResults,
  tasks,
  trainingCourses,
  tlsEndpoints,
  vulnIntel,
} from "../../db/schema";
import { fetchSecureScore } from "../identity/entra";
import { sourceSecret } from "../identity/service";
import { socSlaItems } from "../soc/service";
import { loadCourses } from "../awareness/routes";
import { collectObligations, kindsForModules } from "../notifications/obligations";
import { loadPolicies } from "../policies/routes";
import { getVulnSla, vulnOverdueSql, vulnPrioritySql } from "../vulnerabilities/intel";

/* ============================================================
 * Průběžné monitorování opatření (ADR-096). Kolektory jen čtou data CONTIXu (a u Secure Score Microsoft Graph);
 * každý běh = neměnný řádek `control_monitor_runs`. Chyba zdroje (nesynchronizovaný adresář, chybějící oprávnění)
 * = běh „error“, nikdy „pass“ – test za období pak výpadek započte jako výjimku.
 * ============================================================ */

type MonitorRow = typeof controlMonitors.$inferSelect;
type Collected = { value: number; population: number | null; exceptions: number | null; summary: string; details: { ref: string; detail: string }[] };
class MonitorError extends Error {}

const DAY = 86_400_000;
const day = (d: Date) => d.toISOString().slice(0, 10);
const PRIO_NUM = { p1: 1, p2: 2, p3: 3, p4: 4 } as const;
const pct = (ok: number, all: number) => (all ? Math.round((ok / all) * 1000) / 10 : 100);
const top = <T,>(list: T[], f: (x: T) => { ref: string; detail: string }) => list.slice(0, 50).map(f);
/** Oprávnění ke čtení podrobností běhu (jména účtů, aktiv) podle zdroje dat. */
const DETAIL_PERM: Record<(typeof MONITOR_SPEC)[ControlMonitorKind]["source"], Permission> = {
  identity: "identity:read",
  entra: "identity:read",
  vulnerabilities: "assets:read",
  sca: "assets:read",
  assets: "assets:read",
  tls: "assets:read",
  soc: "soc:read",
  awareness: "awareness:read",
  policies: "policies:read",
  obligations: "isms:read",
  external: "controls:read",
};

async function identityScope(db: Db, m: MonitorRow, p: MonitorParams, kinds?: ("ad" | "entra")[]) {
  const where = and(eq(identitySources.companyId, m.companyId), eq(identitySources.enabled, true), p.sourceId ? eq(identitySources.id, p.sourceId) : undefined, kinds ? inArray(identitySources.kind, kinds) : undefined);
  const sources = await db.select().from(identitySources).where(where);
  if (!sources.length) throw new MonitorError("V rozsahu není žádný zapnutý zdroj identit (AD / Entra ID).");
  const broken = sources.filter((s) => s.lastStatus !== "ok");
  if (broken.length) throw new MonitorError(`Zdroj bez úspěšné synchronizace: ${broken.map((s) => s.name).join(", ")} – běh se nevyhodnotí z neúplných dat.`);
  return sources;
}

export async function collectMonitor(db: Db, config: Config, m: MonitorRow, now = new Date()): Promise<Collected> {
  const kind = m.kind;
  const p = monitorParamsOf(kind, m.params);
  switch (kind) {
    case "identity_mfa": {
      const sources = await identityScope(db, m, p);
      const accts = await db
        .select({ id: identityAccounts.id, login: identityAccounts.login, mfa: identityAccounts.mfa, source: identitySources.name })
        .from(identityAccounts)
        .innerJoin(identitySources, eq(identitySources.id, identityAccounts.sourceId))
        .where(and(inArray(identityAccounts.sourceId, sources.map((s) => s.id)), eq(identityAccounts.enabled, true), isNull(identityAccounts.removedAt), sql`${identityAccounts.kind} <> 'service'`));
      const known = accts.filter((a) => a.mfa !== null);
      if (!known.length) throw new MonitorError("Zdroj nevrací údaj o registraci MFA (u Entra ID je potřeba oprávnění AuditLog.Read.All a licence P1).");
      // schválená výjimka nálezu „bez MFA“ se počítá jako vyhovující
      const accepted = new Set(
        (await db.select({ id: identityFindings.accountId }).from(identityFindings).where(and(inArray(identityFindings.sourceId, sources.map((s) => s.id)), eq(identityFindings.rule, "no_mfa"), eq(identityFindings.status, "accepted")))).map((r) => r.id),
      );
      const bad = known.filter((a) => a.mfa === false && !accepted.has(a.id));
      const value = pct(known.length - bad.length, known.length);
      return { value, population: known.length, exceptions: bad.length, summary: `MFA ${value} % (${known.length - bad.length} z ${known.length} účtů)`, details: top(bad, (a) => ({ ref: a.login, detail: `bez MFA (${a.source})` })) };
    }
    case "identity_hygiene": {
      const sources = await identityScope(db, m, p);
      const rows = await db
        .select({ rule: identityFindings.rule, severity: identityFindings.severity, subject: identityFindings.subject, detail: identityFindings.detail })
        .from(identityFindings)
        .where(and(inArray(identityFindings.sourceId, sources.map((s) => s.id)), eq(identityFindings.status, "open"), inArray(identityFindings.severity, ["critical", "high"])));
      const [pop] = await db.select({ n: sql<number>`count(*)::int` }).from(identityAccounts).where(and(inArray(identityAccounts.sourceId, sources.map((s) => s.id)), eq(identityAccounts.enabled, true), isNull(identityAccounts.removedAt)));
      return { value: rows.length, population: pop?.n ?? 0, exceptions: rows.length, summary: `${rows.length} kritických / vysokých nálezů u ${pop?.n ?? 0} účtů`, details: top(rows, (r) => ({ ref: r.subject.replace(/^group:/, ""), detail: `${r.rule}: ${r.detail}` })) };
    }
    case "privileged_accounts": {
      const sources = await identityScope(db, m, p);
      const rows = await db
        .select({ login: identityAccounts.login, via: identityAccounts.privilegedVia, mfa: identityAccounts.mfa })
        .from(identityAccounts)
        .where(and(inArray(identityAccounts.sourceId, sources.map((s) => s.id)), eq(identityAccounts.enabled, true), eq(identityAccounts.privileged, true), isNull(identityAccounts.removedAt)))
        .orderBy(asc(identityAccounts.login));
      return { value: rows.length, population: rows.length, exceptions: null, summary: `${rows.length} privilegovaných účtů`, details: top(rows, (r) => ({ ref: r.login, detail: `${r.via.join(", ")}${r.mfa === false ? " · bez MFA" : ""}` })) };
    }
    case "m365_secure_score": {
      const [src] = await identityScope(db, m, p, ["entra"]);
      const secret = sourceSecret(src!, config);
      if (!secret) throw new MonitorError("Zdroj Entra ID nemá uložený tajný klíč.");
      let s;
      try {
        s = await fetchSecureScore({ config: EntraSourceConfig.parse(src!.config), secret, env: config });
      } catch (e) {
        throw new MonitorError((e as Error).message);
      }
      const weakest = [...s.controls].sort((a, b) => a.score - b.score).slice(0, 15);
      return { value: s.pct, population: null, exceptions: null, summary: `Secure Score ${s.pct} % (${s.current} z ${s.max}${s.date ? `, ${s.date}` : ""})`, details: weakest.map((c) => ({ ref: c.name, detail: `skóre ${c.score}` })) };
    }
    case "vuln_overdue": {
      const sla = await getVulnSla(db);
      const prios = (p.priorities?.length ? p.priorities : (["p1", "p2"] as const)).map((x) => PRIO_NUM[x]);
      const rows = await db
        .select({ cve: assetVulnerabilities.cveId, asset: assets.name, prio: vulnPrioritySql })
        .from(assetVulnerabilities)
        .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
        .leftJoin(vulnIntel, eq(vulnIntel.cveId, assetVulnerabilities.cveId))
        .where(and(eq(assets.companyId, m.companyId), vulnOverdueSql(sla), sql`${vulnPrioritySql} in (${sql.join(prios.map((n) => sql`${n}`), sql`, `)})`));
      return { value: rows.length, population: null, exceptions: rows.length, summary: `${rows.length} zranitelností P${prios.join("/P")} po termínu opravy`, details: top(rows, (r) => ({ ref: r.cve, detail: `${r.asset} · P${r.prio}` })) };
    }
    case "vuln_kev": {
      const grace = new Date(now.getTime() - (p.graceDays ?? 14) * DAY);
      const rows = await db
        .select({ cve: assetVulnerabilities.cveId, asset: assets.name, since: assetVulnerabilities.firstSeenAt })
        .from(assetVulnerabilities)
        .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
        .innerJoin(vulnIntel, eq(vulnIntel.cveId, assetVulnerabilities.cveId))
        .where(and(eq(assets.companyId, m.companyId), eq(assetVulnerabilities.status, "open"), eq(vulnIntel.kev, true), lt(assetVulnerabilities.firstSeenAt, grace)));
      return { value: rows.length, population: null, exceptions: rows.length, summary: `${rows.length} otevřených zranitelností z katalogu KEV starších ${p.graceDays ?? 14} dní`, details: top(rows, (r) => ({ ref: r.cve, detail: `${r.asset} · od ${day(r.since)}` })) };
    }
    case "sca_score": {
      const rows = await db.select({ asset: assets.name, policy: scaResults.policyName, score: scaResults.score }).from(scaResults).innerJoin(assets, eq(assets.id, scaResults.assetId)).where(and(eq(scaResults.companyId, m.companyId), sql`${scaResults.score} is not null`));
      if (!rows.length) throw new MonitorError("Žádné výsledky shody konfigurace (Wazuh SCA) – spusťte synchronizaci.");
      const avg = Math.round(rows.reduce((a, r) => a + (r.score ?? 0), 0) / rows.length);
      const low = rows.filter((r) => (r.score ?? 0) < (p.minScore ?? 80)).sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
      return { value: avg, population: rows.length, exceptions: low.length, summary: `Průměrné skóre shody ${avg} % (${rows.length} politik na aktivech)`, details: top(low, (r) => ({ ref: r.asset, detail: `${r.policy}: ${r.score} %` })) };
    }
    case "agent_coverage": {
      const stale = new Date(now.getTime() - (p.staleDays ?? 7) * DAY);
      const rows = await db
        .select({
          name: assets.name,
          seen: assets.lastSeenAt,
          agent: sql<boolean>`exists (select 1 from ${assetSources} s where s.asset_id = ${assets.id} and s.source_type = 'wazuh')`,
        })
        .from(assets)
        .where(and(eq(assets.companyId, m.companyId), eq(assets.lifecycleStatus, "active"), inArray(assets.assetType, ["server", "workstation", "laptop", "virtual_machine"]), p.productionOnly ? eq(assets.environment, "production") : undefined));
      if (!rows.length) throw new MonitorError("V evidenci nejsou žádné aktivní servery ani koncová zařízení.");
      const bad = rows.filter((r) => !r.agent || !r.seen || r.seen < stale);
      const value = pct(rows.length - bad.length, rows.length);
      return { value, population: rows.length, exceptions: bad.length, summary: `Pokrytí agentem ${value} % (${rows.length - bad.length} z ${rows.length} zařízení)`, details: top(bad, (r) => ({ ref: r.name, detail: r.agent ? `agent naposledy ${r.seen ? day(r.seen) : "nikdy"}` : "bez agenta" })) };
    }
    case "eol_assets": {
      const rows = await db
        .select({ name: assets.name, os: assets.osName, ver: assets.osVersion, eol: assets.osEolDate })
        .from(assets)
        .where(and(eq(assets.companyId, m.companyId), eq(assets.lifecycleStatus, "active"), eq(assets.supportStatus, "eol"), p.productionOnly ? eq(assets.environment, "production") : undefined));
      return { value: rows.length, population: null, exceptions: rows.length, summary: `${rows.length} aktivních systémů bez podpory výrobce`, details: top(rows, (r) => ({ ref: r.name, detail: `${[r.os, r.ver].filter(Boolean).join(" ")}${r.eol ? ` (EOL ${r.eol})` : ""}` })) };
    }
    case "tls_expiry": {
      const limit = new Date(now.getTime() + (p.warnDays ?? 14) * DAY);
      const all = await db.select({ host: tlsEndpoints.host, port: tlsEndpoints.port, notAfter: tlsEndpoints.notAfter }).from(tlsEndpoints).where(and(eq(tlsEndpoints.companyId, m.companyId), eq(tlsEndpoints.enabled, true)));
      if (!all.length) throw new MonitorError("Nejsou evidované žádné koncové body TLS.");
      const bad = all.filter((e) => e.notAfter && e.notAfter < limit);
      return { value: bad.length, population: all.length, exceptions: bad.length, summary: `${bad.length} z ${all.length} certifikátů po platnosti nebo končí do ${p.warnDays ?? 14} dní`, details: top(bad, (e) => ({ ref: `${e.host}:${e.port}`, detail: `platnost do ${day(e.notAfter!)}` })) };
    }
    case "soc_sla": {
      const items = (await socSlaItems(db, [m.companyId], 0, now)).filter((i) => i.urgency === "overdue");
      return { value: items.length, population: null, exceptions: items.length, summary: `${items.length} alertů / případů SOC po lhůtě`, details: top(items, (i) => ({ ref: i.title.slice(0, 120), detail: i.detail ?? "" })) };
    }
    case "training_completion": {
      const list = (await loadCourses(db, and(eq(trainingCourses.companyId, m.companyId), eq(trainingCourses.active, true)))).map((x) => x.item).filter((x) => x.required > 0);
      if (!list.length) throw new MonitorError("Žádný aktivní kurz s povinnými účastníky.");
      const req = list.reduce((a, x) => a + x.required, 0);
      const okOf = (x: (typeof list)[number]) => x.stats.ok + x.stats.due_soon;
      const ok = list.reduce((a, x) => a + okOf(x), 0);
      const value = pct(ok, req);
      const weak = list.filter((x) => okOf(x) < x.required).sort((a, b) => okOf(a) / a.required - okOf(b) / b.required);
      return { value, population: req, exceptions: req - ok, summary: `Splněno ${value} % povinných školení (${ok} z ${req} v ${list.length} kurzech)`, details: top(weak, (x) => ({ ref: `${x.code ? `${x.code} ` : ""}${x.title}`.slice(0, 200), detail: `${okOf(x)} z ${x.required} (${pct(okOf(x), x.required)} %), po termínu ${x.stats.overdue + x.stats.missing}` })) };
    }
    case "policy_ack": {
      const list = (await loadPolicies(db, eq(policies.companyId, m.companyId))).map((x) => x.item).filter((x) => x.ack.required > 0);
      if (!list.length) throw new MonitorError("Žádný platný dokument s povinným seznámením.");
      const req = list.reduce((a, x) => a + x.ack.required, 0);
      const done = list.reduce((a, x) => a + x.ack.done, 0);
      const value = pct(done, req);
      const weak = list.filter((x) => x.ack.done < x.ack.required).sort((a, b) => a.ack.done / a.ack.required - b.ack.done / b.ack.required);
      return { value, population: req, exceptions: req - done, summary: `Seznámeno ${value} % (${done} z ${req} potvrzení u ${list.length} dokumentů)`, details: top(weak, (x) => ({ ref: `${x.code ? `${x.code} ` : ""}${x.title}`.slice(0, 200), detail: `${x.ack.done} z ${x.ack.required}` })) };
    }
    case "obligations_overdue": {
      const enabled = (await getSettings(db)).enabledModules as string[];
      const kinds = p.obligationKinds?.length ? new Set(p.obligationKinds) : kindsForModules(enabled);
      const items = (await collectObligations(db, { companyIds: [m.companyId], leadDays: 0, now, kinds, includeLater: false })).filter((o) => o.urgency === "overdue");
      return { value: items.length, population: null, exceptions: items.length, summary: `${items.length} povinností po termínu`, details: top(items, (o) => ({ ref: o.title.slice(0, 200), detail: `termín ${o.due?.slice(0, 10) ?? "—"}${o.ownerName ? ` · ${o.ownerName}` : ""}` })) };
    }
    case "external_check":
      // výsledky posílá skript (recordPush); plánovač sem dojde jen tehdy, když výsledek nedorazil včas
      throw new MonitorError(`Externí kontrola nedodala výsledek v intervalu (${MONITOR_LABELS.frequency[m.frequency].toLowerCase()}) – zkontrolujte skript a token.`);
  }
}

/** Jeden běh monitoru → neměnný záznam. Nikdy nevyhazuje – chyba zdroje = běh „error“. */
export async function runMonitor(db: Db, config: Config, m: MonitorRow, now = new Date()) {
  let row: typeof controlMonitorRuns.$inferInsert;
  try {
    const c = await collectMonitor(db, config, m, now);
    const ev = evaluateMonitor(m.kind, c.value, m.params);
    row = { monitorId: m.id, companyId: m.companyId, runAt: now, result: ev.result, value: c.value, threshold: ev.threshold, population: c.population, exceptions: c.exceptions, summary: c.summary.slice(0, 1000), details: c.details };
  } catch (e) {
    const msg = e instanceof MonitorError ? e.message : `Neočekávaná chyba: ${(e as Error).message}`;
    row = { monitorId: m.id, companyId: m.companyId, runAt: now, result: "error", summary: msg.slice(0, 1000), details: [] };
  }
  return recordRun(db, m, row, now);
}

/** Zápis běhu (plánovač, ruční spuštění i výsledek externí kontroly) + úkol při nesplnění (v1.13, ADR-109). */
async function recordRun(db: Db, m: MonitorRow, row: typeof controlMonitorRuns.$inferInsert, now: Date) {
  const [r] = await db.insert(controlMonitorRuns).values(row).returning();
  let openTaskId = m.openTaskId;
  if (m.autoTask && r!.result !== "pass") {
    const [cur] = openTaskId ? await db.select({ status: tasks.status }).from(tasks).where(eq(tasks.id, openTaskId)) : [];
    if (!cur || cur.status === "done" || cur.status === "cancelled") {
      const [ctl] = await db.select({ code: controls.code, name: controls.name, owner: controls.ownerPositionId }).from(controls).where(eq(controls.id, m.controlId));
      const label = m.name || MONITOR_LABELS.kind[m.kind];
      const due = new Date(now.getTime() + 7 * DAY);
      const [t] = await db
        .insert(tasks)
        .values({
          companyId: m.companyId,
          title: `${r!.result === "error" ? "Monitor neproběhl" : "Monitor nesplněn"}: ${label} – ${ctl?.code ? `${ctl.code} ` : ""}${ctl?.name ?? ""}`.slice(0, 500),
          description: `${r!.summary}\n\nÚkol založil průběžný monitoring opatření (${day(now)}). Po nápravě ho uzavřete; při dalším nesplnění vznikne nový.`.slice(0, 5000),
          sourceKind: "control",
          sourceId: m.controlId,
          ownerPositionId: ctl?.owner ?? null,
          dueDate: day(due),
          priority: r!.result === "fail" ? "high" : "medium",
        })
        .returning({ id: tasks.id });
      openTaskId = t!.id;
    }
  }
  await db.update(controlMonitors).set({ lastRunAt: now, lastResult: r!.result, lastSummary: r!.summary, openTaskId, updatedAt: new Date() }).where(eq(controlMonitors.id, m.id));
  return r!;
}

/** Výsledek externí kontroly podle tokenu (jen druh external_check, zapnutý monitor). */
export async function recordPush(db: Db, token: string, input: ReturnType<typeof MonitorPushInput.parse>, now = new Date()) {
  const hash = createHash("sha256").update(token).digest("hex");
  const [m] = await db.select().from(controlMonitors).where(and(eq(controlMonitors.tokenHash, hash), eq(controlMonitors.kind, "external_check")));
  if (!m || !m.enabled) return null;
  const ev = input.value !== undefined ? evaluateMonitor(m.kind, input.value, m.params) : null;
  const result: MonitorResult = input.result ?? ev!.result;
  const summary = input.summary || (input.value !== undefined ? `Externí kontrola: ${input.value} nálezů` : `Externí kontrola: ${MONITOR_LABELS.result[result].toLowerCase()}`);
  return { monitor: m, run: await recordRun(db, m, { monitorId: m.id, companyId: m.companyId, runAt: now, result, value: input.value ?? null, threshold: ev?.threshold ?? null, population: input.population ?? null, exceptions: input.value !== undefined ? Math.round(input.value) : null, summary: summary.slice(0, 1000), details: input.details.map((d) => ({ ref: d.ref, detail: d.detail ?? "" })) }, now) };
}

/** Plánovač: monitory, kterým uplynul interval (s rezervou hodiny). */
export async function processMonitors(db: Db, config: Config, now = new Date()) {
  const enabled = new Set((await getSettings(db)).enabledModules as string[]);
  if (!enabled.has("controls")) return 0;
  const rows = await db.select().from(controlMonitors).where(eq(controlMonitors.enabled, true));
  let n = 0;
  for (const m of rows) {
    if (!enabled.has(MONITOR_SPEC[m.kind]?.module ?? "controls")) continue;
    if (m.kind === "external_check") {
      // výsledek posílá skript – chyba až po intervalu + 2 h rezervy od posledního výsledku (nebo založení)
      const base = m.lastRunAt ?? m.createdAt;
      if (now.getTime() - base.getTime() < (MONITOR_FREQ_HOURS[m.frequency] + 2) * 3_600_000) continue;
    } else if (m.lastRunAt && now.getTime() - m.lastRunAt.getTime() < (MONITOR_FREQ_HOURS[m.frequency] - 1) * 3_600_000) continue;
    await runMonitor(db, config, m, now);
    n++;
  }
  return n;
}

/** Test provozní účinnosti za období složený z běhů (každý běh = vzorek, výpadek = výjimka) + CSV důkaz. */
export async function monitorPeriodTest(db: Db, m: MonitorRow, input: { from: string; to: string; tolerable: number }, userId: string | null) {
  const runs = await db
    .select()
    .from(controlMonitorRuns)
    .where(and(eq(controlMonitorRuns.monitorId, m.id), gte(controlMonitorRuns.runAt, new Date(`${input.from}T00:00:00Z`)), lte(controlMonitorRuns.runAt, new Date(`${input.to}T23:59:59.999Z`))))
    .orderBy(asc(controlMonitorRuns.runAt));
  const sum = monitorPeriod(runs, input.from, input.to, m.frequency, input.tolerable);
  if (!sum.runs) throw new MonitorError("V období neproběhl žádný běh monitoru.");
  const label = MONITOR_LABELS.kind[m.kind];
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [
    ["Běh", "Výsledek", "Hodnota", "Práh", "Populace", "Výjimky", "Souhrn"].map(cell).join(";"),
    ...runs.map((r) => [r.runAt.toISOString(), MONITOR_LABELS.result[r.result], r.value, r.threshold, r.population, r.exceptions, r.summary].map(cell).join(";")),
  ].join("\r\n");
  const content = new TextEncoder().encode(`﻿${csv}\r\n`);
  return db.transaction(async (tx) => {
    const [ev] = await tx
      .insert(evidence)
      .values({ companyId: m.companyId, title: `Monitorování: ${m.name || label} ${input.from} – ${input.to}`.slice(0, 300), description: `Záznam ${sum.runs} běhů monitoru (${MONITOR_LABELS.frequency[m.frequency].toLowerCase()}), očekáváno ${sum.expected}.`, kind: "export", collectedAt: input.to, periodFrom: input.from, periodTo: input.to, validUntil: day(new Date(new Date(`${input.to}T00:00:00Z`).getTime() + 400 * DAY)), createdById: userId })
      .returning({ id: evidence.id });
    await tx.insert(evidenceFiles).values({ evidenceId: ev!.id, filename: `monitoring-${input.from}-${input.to}.csv`, mime: "text/csv", size: content.byteLength, sha256: createHash("sha256").update(content).digest("hex"), content: Buffer.from(content), uploadedById: userId });
    await tx.insert(evidenceControls).values({ evidenceId: ev!.id, controlId: m.controlId });
    const result = sum.result === "not_tested" ? "ineffective" : sum.result;
    const [t] = await tx
      .insert(controlTests)
      .values({
        companyId: m.companyId,
        controlId: m.controlId,
        kind: "operating",
        title: `Průběžné monitorování: ${m.name || label} (${input.from} – ${input.to})`.slice(0, 300),
        methods: ["reperformance"],
        periodFrom: input.from,
        periodTo: input.to,
        status: "completed",
        tester: "CONTIX – průběžné monitorování",
        populationSize: sum.runs,
        procedure: `CONTIX automaticky vyhodnocoval „${label}“ (${MONITOR_LABELS.frequency[m.frequency].toLowerCase()}) nad daty zdroje; práh ${JSON.stringify(monitorParamsOf(m.kind, m.params))}. Každý běh je neměnný záznam; vzorkem testu je každý běh v období. Chybějící běhy (pod 90 % očekávaných) a běhy s chybou zdroje se počítají jako výjimka.`,
        tolerableExceptions: input.tolerable,
        result,
        conclusion: `Běhů ${sum.runs} z očekávaných ${sum.expected} (pokrytí ${sum.coverage} %): splněno ${sum.passed}, nesplněno ${sum.failed}, chyba ${sum.errors}.${sum.gap ? " Monitorování v části období neběželo." : ""}`,
        performedAt: day(new Date()),
        monitorId: m.id,
        createdById: userId,
      })
      .returning({ id: controlTests.id });
    const samples = runs.map((r, i) => ({ testId: t!.id, ref: r.runAt.toISOString().slice(0, 16).replace("T", " "), description: r.summary, result: r.result === "pass" ? ("pass" as const) : ("fail" as const), note: r.result === "error" ? "Běh neproběhl (chyba zdroje)" : null, evidenceId: ev!.id, order: i }));
    if (sum.gap) samples.push({ testId: t!.id, ref: "Výpadek monitorování", description: `Proběhlo ${sum.runs} z ${sum.expected} očekávaných běhů`, result: "fail", note: null, evidenceId: ev!.id, order: samples.length });
    for (let i = 0; i < samples.length; i += 500) await tx.insert(controlTestSamples).values(samples.slice(i, i + 500));
    return { testId: t!.id, evidenceId: ev!.id, ...sum, result };
  });
}

/* ---------------- API ---------------- */

export function monitorRoutes(deps: { db: Db; config: Config }) {
  const { db, config } = deps;
  async function row(c: Context<AppEnv>, id: string) {
    const [m] = await db.select().from(controlMonitors).where(eq(controlMonitors.id, id));
    if (!m) throw new HTTPException(404, { message: "Monitor nenalezen" });
    assertScope(c, m.companyId, "Monitor nenalezen");
    return m;
  }
  async function controlFor(c: Context<AppEnv>, id: string) {
    const [ctl] = await db.select({ id: controls.id, companyId: controls.companyId }).from(controls).where(eq(controls.id, id));
    if (!ctl) throw new HTTPException(400, { message: "Opatření nenalezeno" });
    assertScope(c, ctl.companyId, "Opatření nenalezeno");
    if (!hasPermIn(c, "controls:test", ctl.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
    return ctl;
  }
  const runDto = (c: Context<AppEnv>, kind: ControlMonitorKind, companyId: string, r: typeof controlMonitorRuns.$inferSelect): MonitorRunDto => ({
    id: r.id,
    runAt: r.runAt.toISOString(),
    result: r.result,
    value: r.value,
    threshold: r.threshold,
    population: r.population,
    exceptions: r.exceptions,
    summary: r.summary,
    // jména účtů / aktiv jen s oprávněním ke zdroji dat
    details: hasPermIn(c, DETAIL_PERM[MONITOR_SPEC[kind].source], companyId) ? r.details : [],
  });
  async function list(c: Context<AppEnv>, where: SQL | undefined): Promise<ControlMonitorDto[]> {
    const rows = await db.select({ m: controlMonitors, name: controls.name, code: controls.code }).from(controlMonitors).innerJoin(controls, eq(controls.id, controlMonitors.controlId)).where(where).orderBy(asc(controls.code), asc(controlMonitors.kind));
    if (!rows.length) return [];
    const ids = rows.map((r) => r.m.id);
    const recent = await db.execute<{ monitor_id: string; run_at: string; result: MonitorResult }>(sql`
      select monitor_id, run_at, result from (
        select monitor_id, run_at, result, row_number() over (partition by monitor_id order by run_at desc) rn
          from control_monitor_runs where monitor_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})) x
       where rn <= 30 order by run_at`);
    const rate = await db
      .select({ id: controlMonitorRuns.monitorId, n: sql<number>`count(*)::int`, ok: sql<number>`count(*) filter (where ${controlMonitorRuns.result} = 'pass')::int` })
      .from(controlMonitorRuns)
      .where(and(inArray(controlMonitorRuns.monitorId, ids), gte(controlMonitorRuns.runAt, new Date(Date.now() - 90 * DAY))))
      .groupBy(controlMonitorRuns.monitorId);
    const rm = new Map(rate.map((r) => [r.id, r]));
    const rec = new Map<string, { runAt: string; result: MonitorResult }[]>();
    for (const r of recent as unknown as { monitor_id: string; run_at: string | Date; result: MonitorResult }[]) {
      const l = rec.get(r.monitor_id) ?? [];
      l.push({ runAt: new Date(r.run_at).toISOString(), result: r.result });
      rec.set(r.monitor_id, l);
    }
    return rows.map(({ m, name, code }) => {
      const r = rm.get(m.id);
      return {
        id: m.id,
        companyId: m.companyId,
        controlId: m.controlId,
        controlName: `${code ? `${code} ` : ""}${name}`,
        kind: m.kind,
        name: m.name,
        frequency: m.frequency,
        params: monitorParamsOf(m.kind, m.params),
        enabled: m.enabled,
        lastRunAt: m.lastRunAt?.toISOString() ?? null,
        lastResult: m.lastResult,
        lastSummary: m.lastSummary,
        recent: rec.get(m.id) ?? [],
        passRate90: r?.n ? Math.round((r.ok / r.n) * 100) : null,
        autoTask: m.autoTask,
        openTaskId: m.openTaskId,
        hasToken: !!m.tokenHash,
      };
    });
  }
  const values = (i: ReturnType<typeof ControlMonitorInput.parse>) => ({ controlId: i.controlId, kind: i.kind, name: i.name ?? "", frequency: i.frequency, params: monitorParamsOf(i.kind, i.params), enabled: i.enabled, autoTask: i.autoTask });

  return new Hono<AppEnv>()
    .use("*", requireModule(db, "controls"))
    .get("/", requirePerm("controls:read"), async (c) => {
      const controlId = c.req.query("controlId");
      return c.json(await list(c, and(inScope(c, controlMonitors.companyId), controlId ? eq(controlMonitors.controlId, controlId) : undefined)));
    })
    .post("/", requirePerm("controls:test"), zValidator("json", ControlMonitorInput), async (c) => {
      const input = c.req.valid("json");
      const ctl = await controlFor(c, input.controlId);
      const [m] = await db.insert(controlMonitors).values({ ...values(input), companyId: ctl.companyId, createdById: currentUser(c).id }).returning();
      await audit(db, { c, user: currentUser(c), action: "control_monitor.created", entityType: "control", entityId: ctl.id, details: { monitorId: m!.id, ...values(input) } });
      return c.json((await list(c, eq(controlMonitors.id, m!.id)))[0], 201);
    })
    .put("/:id", requirePerm("controls:test"), zValidator("json", ControlMonitorInput), async (c) => {
      const prev = await row(c, c.req.param("id"));
      const input = c.req.valid("json");
      if (input.kind !== prev.kind) throw new HTTPException(400, { message: "Druh monitoru nelze změnit – založte nový monitor." });
      const ctl = await controlFor(c, input.controlId);
      await db.update(controlMonitors).set({ ...values(input), companyId: ctl.companyId, updatedAt: new Date() }).where(eq(controlMonitors.id, prev.id));
      await audit(db, { c, user: currentUser(c), action: "control_monitor.updated", entityType: "control", entityId: ctl.id, details: { monitorId: prev.id, ...values(input) } });
      return c.json((await list(c, eq(controlMonitors.id, prev.id)))[0]);
    })
    .delete("/:id", requirePerm("controls:test"), async (c) => {
      const prev = await row(c, c.req.param("id"));
      await controlFor(c, prev.controlId);
      const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(controlMonitorRuns).where(eq(controlMonitorRuns.monitorId, prev.id));
      if (n!.n > 0) throw new HTTPException(409, { message: "Monitor s historií běhů nelze smazat (je to důkaz pro audit) – vypněte ho." });
      await db.delete(controlMonitors).where(eq(controlMonitors.id, prev.id));
      await audit(db, { c, user: currentUser(c), action: "control_monitor.deleted", entityType: "control", entityId: prev.controlId, details: { monitorId: prev.id } });
      return c.json({ ok: true });
    })
    /** Nový token externí kontroly – starý přestane platit; hodnota se vrací jen teď. */
    .post("/:id/token", requirePerm("controls:test"), async (c) => {
      const m = await row(c, c.req.param("id"));
      await controlFor(c, m.controlId);
      if (m.kind !== "external_check") throw new HTTPException(400, { message: "Token má jen externí kontrola" });
      const token = `cxm_${randomBytes(24).toString("base64url")}`;
      await db.update(controlMonitors).set({ tokenHash: createHash("sha256").update(token).digest("hex"), updatedAt: new Date() }).where(eq(controlMonitors.id, m.id));
      await audit(db, { c, user: currentUser(c), action: "control_monitor.token_issued", entityType: "control", entityId: m.controlId, details: { monitorId: m.id } });
      return c.json({ token });
    })
    .post("/:id/run", requirePerm("controls:test"), async (c) => {
      const m = await row(c, c.req.param("id"));
      await controlFor(c, m.controlId);
      if (m.kind === "external_check") throw new HTTPException(409, { message: "Výsledek externí kontroly posílá skript – nelze spustit ručně" });
      const r = await runMonitor(db, config, m);
      await audit(db, { c, user: currentUser(c), action: "control_monitor.run", entityType: "control", entityId: m.controlId, details: { monitorId: m.id, result: r.result } });
      return c.json(runDto(c, m.kind, m.companyId, r));
    })
    .get("/:id/runs", requirePerm("controls:read"), async (c) => {
      const m = await row(c, c.req.param("id"));
      const from = c.req.query("from");
      const to = c.req.query("to");
      const ok = (d?: string) => !d || /^\d{4}-\d{2}-\d{2}$/.test(d);
      if (!ok(from) || !ok(to)) throw new HTTPException(400, { message: "Neplatné datum" });
      const rows = await db
        .select()
        .from(controlMonitorRuns)
        .where(and(eq(controlMonitorRuns.monitorId, m.id), from ? gte(controlMonitorRuns.runAt, new Date(`${from}T00:00:00Z`)) : undefined, to ? lte(controlMonitorRuns.runAt, new Date(`${to}T23:59:59.999Z`)) : undefined))
        .orderBy(desc(controlMonitorRuns.runAt))
        .limit(500);
      return c.json(rows.map((r) => runDto(c, m.kind, m.companyId, r)));
    })
    .post("/:id/period-test", requirePerm("controls:test"), zValidator("json", MonitorPeriodTestInput), async (c) => {
      const m = await row(c, c.req.param("id"));
      await controlFor(c, m.controlId);
      try {
        const r = await monitorPeriodTest(db, m, c.req.valid("json"), currentUser(c).id);
        await audit(db, { c, user: currentUser(c), action: "control_test.from_monitor", entityType: "control", entityId: m.controlId, details: { monitorId: m.id, testId: r.testId, runs: r.runs, result: r.result } });
        return c.json(r, 201);
      } catch (e) {
        if (e instanceof MonitorError) throw new HTTPException(409, { message: e.message });
        throw e;
      }
    });
}

/** Testy za období zakázky SOC 2 Type II ze všech zapnutých monitorů opatření v rozsahu (bez duplicit pro stejné období). */
export async function soc2MonitorTests(db: Db, companyId: string, controlIds: string[], from: string, to: string, userId: string | null) {
  if (!controlIds.length) return { created: [] as string[], skipped: 0, failed: [] as string[] };
  const ms = await db.select().from(controlMonitors).where(and(eq(controlMonitors.companyId, companyId), inArray(controlMonitors.controlId, controlIds)));
  const created: string[] = [];
  const failed: string[] = [];
  let skipped = 0;
  for (const m of ms) {
    const [dup] = await db.select({ id: controlTests.id }).from(controlTests).where(and(eq(controlTests.monitorId, m.id), eq(controlTests.periodFrom, from), eq(controlTests.periodTo, to)));
    if (dup) {
      skipped++;
      continue;
    }
    try {
      created.push((await monitorPeriodTest(db, m, { from, to, tolerable: 0 }, userId)).testId);
    } catch (e) {
      if (!(e instanceof MonitorError)) throw e;
      failed.push(`${m.name || MONITOR_LABELS.kind[m.kind]}: ${e.message}`);
    }
  }
  return { created, skipped, failed };
}

/**
 * Výsledek externí kontroly ze skriptu (v1.13, ADR-109): `POST /api/public/monitors/result`, hlavička
 * `Authorization: Bearer <token monitoru>`. Bez cookies a CSRF; token platí jen pro svůj monitor.
 */
export function publicMonitorRoutes(db: Db) {
  return new Hono().post("/result", async (c) => {
    if (!((await getSettings(db)).enabledModules as string[]).includes("controls")) throw new HTTPException(404, { message: "Modul není zapnutý" });
    const token = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "")?.[1];
    if (!token || token.length > 200) throw new HTTPException(401, { message: "Chybí token" });
    const parsed = MonitorPushInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new HTTPException(400, { message: "Neplatný výsledek kontroly" });
    const r = await recordPush(db, token, parsed.data);
    if (!r) throw new HTTPException(401, { message: "Neplatný token" });
    await audit(db, { c: c as never, action: "control_monitor.result_pushed", entityType: "control", entityId: r.monitor.controlId, details: { monitorId: r.monitor.id, result: r.run.result, value: r.run.value } });
    return c.json({ runId: r.run.id, result: r.run.result }, 201);
  });
}
