import {
  AUTOMATION_DAYS,
  scaResultOf,
  scaScore,
  scaTestResult,
  type ScaCheckDto,
  type ScaOverviewDto,
  type ScaPolicyResultDto,
  type ScaResult,
} from "@contix/shared";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { appSettings, assets, assetSources, controlAutomations, controls, scaCheckDefs, scaCheckResults, scaResults } from "../../db/schema";
import { getWazuhConfig } from "../connectors/config";
import { wazuhApiClient, type FetchLike } from "../discovery/connectors/wazuh";
import { finishAutomationTest, storeAutomationEvidence } from "../identity/automations";

/* ============================================================
 * Wazuh SCA (ADR-064): načtení výsledků politik a kontrol z Wazuh API (jen čtení) za aktiva spárovaná
 * s agenty Wazuhu; kontroly se načítají jen při změně skenu. Automatický test opatření podle skóre shody.
 * ============================================================ */

const KEY = "sca.lastSync";
const SYNC_HOURS = 24;
type Sync = NonNullable<ScaOverviewDto["lastSync"]>;

/** Pole `compliance` Wazuhu → { rámec: [hodnoty] } (hodnota může být „4.1, 4.2“). */
export function complianceOf(v: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const add = (k: unknown, val: unknown) => {
    const key = String(k ?? "").trim();
    if (!key) return;
    const vals = (Array.isArray(val) ? val : String(val ?? "").split(",")).map((x) => String(x).trim()).filter(Boolean);
    out[key] = [...new Set([...(out[key] ?? []), ...vals])].slice(0, 50);
  };
  const items = Array.isArray(v) ? v : v && typeof v === "object" ? [v] : [];
  for (const x of items) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    if ("key" in o) add(o.key, o.value);
    else for (const [k, val] of Object.entries(o)) add(k, val);
  }
  return out;
}

const txt = (v: unknown, max = 4000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export async function lastScaSync(db: Db): Promise<Sync | null> {
  const [r] = await db.select().from(appSettings).where(eq(appSettings.key, KEY));
  return (r?.value as Sync | undefined) ?? null;
}

/** Načte SCA ze všech agentů spárovaných s aktivy. */
export async function syncSca(db: Db, config: Config, fetchImpl?: FetchLike): Promise<Sync> {
  const out: Sync = { at: new Date().toISOString(), agents: 0, policies: 0, checks: 0, error: null };
  try {
    const w = await getWazuhConfig(db, config);
    if (!w.url || !w.user || !w.password) throw new Error("Wazuh API není nastaveno (Administrace → Konektory).");
    const api = await wazuhApiClient({ url: w.url, user: w.user, password: w.password, verifyTls: w.verifyTls }, fetchImpl);
    const mapped = await db
      .select({ assetId: assets.id, companyId: assets.companyId, agentId: assetSources.sourceRef })
      .from(assetSources)
      .innerJoin(assets, eq(assets.id, assetSources.assetId))
      .where(eq(assetSources.sourceType, "wazuh"));
    const prev = new Map((await db.select().from(scaResults)).map((r) => [`${r.assetId}|${r.policyId}`, r]));
    for (const m of mapped) {
      let policies: any[];
      try {
        policies = (await api.get(`/sca/${encodeURIComponent(m.agentId)}?limit=500`)).items;
      } catch {
        continue; // agent bez SCA / odpojený – přeskočit
      }
      out.agents++;
      for (const p of policies) {
        const policyId = String(p.policy_id ?? "").slice(0, 100);
        if (!policyId) continue;
        out.policies++;
        const scannedAt = p.end_scan ? new Date(p.end_scan) : null;
        const pass = Number(p.pass) || 0;
        const fail = Number(p.fail) || 0;
        const na = Number(p.invalid ?? p.not_applicable) || 0;
        const old = prev.get(`${m.assetId}|${policyId}`);
        await db
          .insert(scaResults)
          .values({ companyId: m.companyId, assetId: m.assetId, agentId: m.agentId, policyId, policyName: String(p.name ?? policyId).slice(0, 300), pass, fail, na, score: scaScore(pass, fail), scannedAt, syncedAt: new Date() })
          .onConflictDoUpdate({
            target: [scaResults.assetId, scaResults.policyId],
            set: { companyId: m.companyId, agentId: m.agentId, policyName: String(p.name ?? policyId).slice(0, 300), pass, fail, na, score: scaScore(pass, fail), scannedAt, syncedAt: new Date() },
          });
        // kontroly jen při novém skenu
        if (old && old.scannedAt && scannedAt && old.scannedAt.getTime() === scannedAt.getTime()) continue;
        const checks: any[] = [];
        for (let offset = 0; offset < 5000; offset += 500) {
          const page = await api.get(`/sca/${encodeURIComponent(m.agentId)}/checks/${encodeURIComponent(policyId)}?limit=500&offset=${offset}`);
          checks.push(...page.items);
          if (page.items.length < 500 || checks.length >= page.total) break;
        }
        for (const c of checks) {
          const checkId = Number(c.id);
          if (!Number.isFinite(checkId)) continue;
          const def = { title: (txt(c.title, 1000) ?? `Kontrola ${checkId}`), description: txt(c.description), rationale: txt(c.rationale), remediation: txt(c.remediation), compliance: complianceOf(c.compliance), updatedAt: new Date() };
          await db.insert(scaCheckDefs).values({ policyId, checkId, ...def }).onConflictDoUpdate({ target: [scaCheckDefs.policyId, scaCheckDefs.checkId], set: def });
        }
        await db.delete(scaCheckResults).where(and(eq(scaCheckResults.assetId, m.assetId), eq(scaCheckResults.policyId, policyId)));
        const rows = checks.filter((c) => Number.isFinite(Number(c.id))).map((c) => ({ assetId: m.assetId, policyId, checkId: Number(c.id), result: scaResultOf(c) }));
        for (let i = 0; i < rows.length; i += 1000) await db.insert(scaCheckResults).values(rows.slice(i, i + 1000)).onConflictDoNothing();
        out.checks += rows.length;
      }
    }
  } catch (e) {
    out.error = (e as Error).message.slice(0, 500);
  }
  await db.insert(appSettings).values({ key: KEY, value: out }).onConflictDoUpdate({ target: appSettings.key, set: { value: out, updatedAt: new Date() } });
  return out;
}

/** Plánovač: jednou denně (je-li nastaveno Wazuh API). */
export async function maybeSyncSca(db: Db, config: Config, now = new Date()) {
  const last = await lastScaSync(db);
  if (last && now.getTime() - new Date(last.at).getTime() < SYNC_HOURS * 3600_000) return null;
  const w = await getWazuhConfig(db, config);
  if (!w.enabled || !w.url || !w.password) return null;
  return syncSca(db, config);
}

export async function policyRows(db: Db, where: SQL | undefined): Promise<ScaPolicyResultDto[]> {
  const rows = await db.select({ r: scaResults, name: assets.name }).from(scaResults).innerJoin(assets, eq(assets.id, scaResults.assetId)).where(where).orderBy(scaResults.policyName, assets.name);
  return rows.map(({ r, name }) => ({ assetId: r.assetId, assetName: name, agentId: r.agentId, policyId: r.policyId, policyName: r.policyName, pass: r.pass, fail: r.fail, na: r.na, score: r.score, scannedAt: r.scannedAt?.toISOString() ?? null }));
}

/** Přehled shody za společnosti. */
export async function scaOverview(db: Db, companyIds: string[]): Promise<ScaOverviewDto> {
  const where = companyIds.length ? inArray(scaResults.companyId, companyIds) : sql`false`;
  const rows = await policyRows(db, where);
  const byPolicy = new Map<string, ScaPolicyResultDto[]>();
  for (const r of rows) byPolicy.set(r.policyId, [...(byPolicy.get(r.policyId) ?? []), r]);
  const policies = [...byPolicy.entries()].map(([policyId, list]) => {
    const pass = list.reduce((n, x) => n + x.pass, 0);
    const fail = list.reduce((n, x) => n + x.fail, 0);
    return {
      policyId,
      policyName: list[0]!.policyName,
      assets: list.length,
      pass,
      fail,
      score: scaScore(pass, fail),
      worst: [...list].sort((a, b) => (a.score ?? 101) - (b.score ?? 101)).slice(0, 5).map((x) => ({ assetId: x.assetId, assetName: x.assetName, score: x.score })),
    };
  });
  const failed = companyIds.length
    ? await db
        .select({
          policyId: scaCheckResults.policyId,
          checkId: scaCheckResults.checkId,
          title: scaCheckDefs.title,
          compliance: scaCheckDefs.compliance,
          n: sql<number>`count(*)::int`,
          assets: sql<{ id: string; name: string }[]>`json_agg(json_build_object('id', ${assets.id}, 'name', ${assets.name}) order by ${assets.name})`,
        })
        .from(scaCheckResults)
        .innerJoin(assets, eq(assets.id, scaCheckResults.assetId))
        .innerJoin(scaCheckDefs, and(eq(scaCheckDefs.policyId, scaCheckResults.policyId), eq(scaCheckDefs.checkId, scaCheckResults.checkId)))
        .where(and(eq(scaCheckResults.result, "failed"), inArray(assets.companyId, companyIds)))
        .groupBy(scaCheckResults.policyId, scaCheckResults.checkId, scaCheckDefs.title, scaCheckDefs.compliance)
        .orderBy(desc(sql`count(*)`), scaCheckResults.checkId)
        .limit(30)
    : [];
  const pass = rows.reduce((n, x) => n + x.pass, 0);
  const fail = rows.reduce((n, x) => n + x.fail, 0);
  return {
    lastSync: await lastScaSync(db),
    totals: { assets: new Set(rows.map((r) => r.assetId)).size, pass, fail, score: scaScore(pass, fail) },
    policies: policies.sort((a, b) => (a.score ?? 101) - (b.score ?? 101)),
    topFailed: failed.map((f) => ({ policyId: f.policyId, checkId: f.checkId, title: f.title, failedOn: f.n, assets: f.assets.slice(0, 20), compliance: f.compliance })),
  };
}

/** Kontroly aktiva (všechny politiky). */
export async function assetChecks(db: Db, assetId: string): Promise<ScaCheckDto[]> {
  const rows = await db
    .select({ r: scaCheckResults, d: scaCheckDefs })
    .from(scaCheckResults)
    .innerJoin(scaCheckDefs, and(eq(scaCheckDefs.policyId, scaCheckResults.policyId), eq(scaCheckDefs.checkId, scaCheckResults.checkId)))
    .where(eq(scaCheckResults.assetId, assetId))
    .orderBy(scaCheckResults.policyId, scaCheckResults.checkId);
  return rows.map(({ r, d }) => ({ policyId: r.policyId, checkId: r.checkId, title: d.title, description: d.description, rationale: d.rationale, remediation: d.remediation, result: r.result as ScaResult, compliance: d.compliance }));
}

/* ---------- automatický test opatření ---------- */

type AutomationRow = typeof controlAutomations.$inferSelect;
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Test opatření ze skóre shody SCA aktiv společnosti opatření (politiky v rozsahu nebo všechny). */
export async function runScaAutomation(db: Db, a: AutomationRow, now = new Date()) {
  const fail = async (msg: string) => {
    await db.update(controlAutomations).set({ lastError: msg, updatedAt: new Date() }).where(eq(controlAutomations.id, a.id));
    throw new Error(msg);
  };
  const last = await lastScaSync(db);
  if (!last) return fail("Výsledky SCA zatím nebyly načteny z Wazuhu.");
  if (last.error) return fail(`Poslední načtení SCA skončilo chybou (${last.error}) – test se neprovede, aby nevycházel z neúplných dat.`);
  const rows = await policyRows(db, and(eq(scaResults.companyId, a.companyId), a.scaPolicies.length ? inArray(scaResults.policyId, a.scaPolicies) : undefined));
  if (!rows.length) return fail("Pro aktiva společnosti nejsou žádné výsledky SCA v rozsahu.");
  const pass = rows.reduce((n, x) => n + x.pass, 0);
  const failN = rows.reduce((n, x) => n + x.fail, 0);
  const score = scaScore(pass, failN);
  const result = scaTestResult(score, a.scaMinScore, a.scaWarnScore);
  const days = AUTOMATION_DAYS[a.frequency];
  const periodTo = day(now);
  const periodFrom = day(a.lastRunAt && a.lastRunAt < now ? a.lastRunAt : new Date(now.getTime() - days * 864e5));
  const [ctl] = await db.select({ name: controls.name, code: controls.code }).from(controls).where(eq(controls.id, a.controlId));
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [["Aktivum", "Politika", "Splněno", "Nesplněno", "Nevztahuje se", "Skóre %", "Sken"].map(cell).join(";"), ...rows.map((r) => [r.assetName, r.policyName, r.pass, r.fail, r.na, r.score ?? "", r.scannedAt?.slice(0, 10) ?? ""].map(cell).join(";"))].join("\r\n");
  const evidenceId = await storeAutomationEvidence(db, a, {
    title: `Shoda konfigurace (Wazuh SCA) ${periodTo}${ctl ? ` – ${ctl.code ? `${ctl.code} ` : ""}${ctl.name}` : ""}`,
    description: `Automatický export výsledků SCA: ${rows.length} kombinací aktivum × politika, skóre ${score ?? "—"} %.`,
    kind: "export",
    periodFrom,
    periodTo,
    validUntil: day(new Date(now.getTime() + days * 2 * 864e5)),
    filename: `sca-shoda-${periodTo}.csv`,
    mime: "text/csv",
    content: new TextEncoder().encode(`﻿${csv}\r\n`),
  });
  return finishAutomationTest(db, a, {
    title: `Automatický test shody konfigurace ${periodTo}`,
    procedure: `CONTIX načetl z Wazuhu výsledky Security Configuration Assessment (${[...new Set(rows.map((r) => r.policyName))].join(", ")}) pro ${new Set(rows.map((r) => r.assetId)).size} aktiv a spočítal skóre shody (splněné / splněné + nesplněné kontroly). Práh: účinné ≥ ${a.scaMinScore} %, s výjimkami ≥ ${a.scaWarnScore} %.`,
    population: rows.length,
    result,
    conclusion:
      result === "effective"
        ? `Skóre shody ${score} % (≥ ${a.scaMinScore} %).`
        : `Skóre shody ${score ?? "—"} % – ${result === "ineffective" ? `pod prahem ${a.scaWarnScore} %; opatření neplní účel, opravte nesplněné kontroly` : `pod cílem ${a.scaMinScore} %, v toleranci`}. Nejslabší: ${[...rows].sort((x, y) => (x.score ?? 101) - (y.score ?? 101)).slice(0, 5).map((r) => `${r.assetName} ${r.score ?? "—"} %`).join(", ")}.`,
    periodFrom,
    periodTo,
    tolerable: 0,
    samples: rows.slice(0, 500).map((r) => ({ ref: `${r.assetName} – ${r.policyName}`, description: `skóre ${r.score ?? "—"} % (splněno ${r.pass}, nesplněno ${r.fail})`, result: (r.score ?? 0) >= a.scaMinScore ? ("pass" as const) : ("fail" as const), evidenceId })),
  });
}

/** Plánovač: automatické testy shody podle frekvence (po načtení SCA). */
export async function processScaAutomations(db: Db, now = new Date()): Promise<string[]> {
  const rows = await db.select().from(controlAutomations).where(and(eq(controlAutomations.kind, "sca"), eq(controlAutomations.enabled, true)));
  const errors: string[] = [];
  for (const a of rows) {
    if (a.lastRunAt && now.getTime() - a.lastRunAt.getTime() < AUTOMATION_DAYS[a.frequency] * 86_400_000 - 3_600_000) continue;
    await runScaAutomation(db, a, now).catch((e) => errors.push((e as Error).message));
  }
  return errors;
}
