import { aiMetrics, riskScore, type ManagementReport, type SocAiTriage, type SocLinkedRisk, type SocMetricRow } from "@contix/shared";
import { and, eq, gte, inArray, lt, type SQL } from "drizzle-orm";
import type { Context } from "hono";
import { hasPermIn, riskPolicies } from "../../auth/scope";
import { getSettings, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { alertSuggestions, assets, riskAssets, risks } from "../../db/schema";
import { socSlaItems } from "./service";

/* ============================================================
 * SOC × řízení rizik (ADR-048): alert / případ ukazuje rizika z registru navázaná na jeho aktiva
 * (jen s risks:read a zapnutým modulem rizik), riziko ukazuje signály SOC ze svých aktiv.
 * Nic se nemění automaticky – přehodnocení rizika je vždy rozhodnutí člověka.
 * ============================================================ */

/** Rizika navázaná na aktiva (ve společnosti záznamu), seřazená podle úrovně. */
export async function linkedRisks(db: Db, c: Context<AppEnv>, companyId: string, assetIds: string[]): Promise<SocLinkedRisk[]> {
  if (!assetIds.length || !hasPermIn(c, "risks:read", companyId)) return [];
  const base = await getSettings(db);
  if (!(base.enabledModules as string[]).includes("risks")) return [];
  const rows = await db
    .select({ r: risks, assetName: assets.name })
    .from(riskAssets)
    .innerJoin(risks, eq(risks.id, riskAssets.riskId))
    .innerJoin(assets, eq(assets.id, riskAssets.assetId))
    .where(and(inArray(riskAssets.assetId, [...new Set(assetIds)]), eq(risks.companyId, companyId)));
  if (!rows.length) return [];
  const policies = await riskPolicies(db, base);
  const order = ["critical", "high", "medium", "low"];
  const seen = new Map<string, SocLinkedRisk>();
  for (const { r, assetName } of rows) {
    if (seen.has(r.id)) continue;
    const pol = policies.get(r.companyId);
    let level: string | null = null;
    try {
      level = pol ? riskScore(pol, r, r.scaleLevels).level : null;
    } catch {
      level = null;
    }
    seen.set(r.id, { id: r.id, name: `${r.code ? `${r.code} ` : ""}${r.name}`, level, assetName });
  }
  const rank = (l: string | null) => {
    const i = order.indexOf(l ?? "");
    return i < 0 ? order.length : i;
  };
  return [...seen.values()].sort((a, b) => rank(a.level) - rank(b.level) || a.name.localeCompare(b.name));
}

/** Statistika SOC za období pro zprávu pro vedení (ADR-048) – počítá se při čtení. */
/** Řádky pro metriky SOC (ADR-053). */
export async function metricRows(db: Db, where: SQL): Promise<SocMetricRow[]> {
  const rows = await db
    .select({
      id: alertSuggestions.id,
      title: alertSuggestions.title,
      description: alertSuggestions.description,
      source: alertSuggestions.source,
      status: alertSuggestions.status,
      verdict: alertSuggestions.verdict,
      ruleLevel: alertSuggestions.ruleLevel,
      exposure: alertSuggestions.exposure,
      createdAt: alertSuggestions.createdAt,
      acknowledgedAt: alertSuggestions.acknowledgedAt,
      decidedAt: alertSuggestions.decidedAt,
      aiTriage: alertSuggestions.aiTriage,
    })
    .from(alertSuggestions)
    .where(where);
  return rows.map((r) => ({ ...r, title: r.title ?? r.description, aiTriage: (r.aiTriage as unknown as SocAiTriage | null) ?? null }));
}

export async function socReportStats(db: Db, companyId: string, from: string, to: string): Promise<NonNullable<ManagementReport["soc"]>> {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(new Date(`${to}T00:00:00Z`).getTime() + 864e5);
  const rows = await db
    .select({ status: alertSuggestions.status, verdict: alertSuggestions.verdict, tactics: alertSuggestions.mitreTactics, createdAt: alertSuggestions.createdAt, ack: alertSuggestions.acknowledgedAt, exposure: alertSuggestions.exposure })
    .from(alertSuggestions)
    .where(and(eq(alertSuggestions.companyId, companyId), gte(alertSuggestions.createdAt, start), lt(alertSuggestions.createdAt, end)));
  let escalated = 0,
    truePositive = 0,
    falsePositive = 0,
    benign = 0,
    exploitAttempts = 0;
  const tactics: Record<string, number> = {};
  const tta: number[] = [];
  for (const r of rows) {
    if (r.status === "accepted") escalated++;
    else if (r.status === "dismissed") {
      if (r.verdict === "true_positive") truePositive++;
      if (r.verdict === "false_positive") falsePositive++;
      if (r.verdict === "benign") benign++;
    }
    if (r.exposure?.exploit) exploitAttempts++;
    for (const t of r.tactics) tactics[t] = (tactics[t] ?? 0) + 1;
    if (r.ack) tta.push(Math.max(0, (r.ack.getTime() - r.createdAt.getTime()) / 3600_000));
  }
  tta.sort((a, b) => a - b);
  const mid = tta.length ? (tta.length % 2 ? tta[(tta.length - 1) / 2]! : (tta[tta.length / 2 - 1]! + tta[tta.length / 2]!) / 2) : null;
  const decided = escalated + truePositive + falsePositive + benign;
  // doba vyřešení a shoda AI triáže s analytikem (ADR-053)
  const mrows = await metricRows(db, and(eq(alertSuggestions.companyId, companyId), gte(alertSuggestions.createdAt, start), lt(alertSuggestions.createdAt, end))!);
  const ttr = mrows.filter((r) => r.decidedAt && (r.status === "accepted" || r.status === "dismissed")).map((r) => Math.max(0, (r.decidedAt!.getTime() - r.createdAt.getTime()) / 3600_000)).sort((a, b) => a - b);
  const ttrMid = ttr.length ? (ttr.length % 2 ? ttr[(ttr.length - 1) / 2]! : (ttr[ttr.length / 2 - 1]! + ttr[ttr.length / 2]!) / 2) : null;
  const ai = aiMetrics(mrows);
  const breached = (await socSlaItems(db, [companyId], 0)).filter((i) => i.urgency === "overdue").length;
  return {
    alerts: rows.length,
    escalated,
    truePositive,
    falsePositive,
    benign,
    fpRate: decided >= 3 ? Math.round(((falsePositive + benign) / decided) * 100) / 100 : null,
    mttaHours: mid == null ? null : Math.round(mid * 10) / 10,
    mttrHours: ttrMid == null ? null : Math.round(ttrMid * 10) / 10,
    aiCompared: ai.compared,
    aiAgreement: ai.compared >= 5 ? ai.agreement : null,
    aiMissed: ai.missed.length,
    openBreached: breached,
    exploitAttempts,
    topTactics: Object.entries(tactics)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, n]) => ({ id, n })),
  };
}
