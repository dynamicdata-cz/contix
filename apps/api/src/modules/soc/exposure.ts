import { CVE_RE, EXPLOIT_BUMP, EXPLOIT_TECHNIQUES, SOC_OPEN_STATUSES, type SocExposure } from "@contix/shared";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { alertSuggestions, assetVulnerabilities } from "../../db/schema";

/* ============================================================
 * Alerty × zranitelnosti (ADR-048): pokus o zneužití na aktivu se známou otevřenou zranitelností
 * zvýší závažnost alertu o jeden stupeň (`effectiveLevel`). Počítá se při synchronizaci, založení
 * ručního alertu a v plánovači (zranitelnosti se mění) – jen pro otevřené alerty s aktivem.
 * ============================================================ */

type Row = typeof alertSuggestions.$inferSelect;

/** Úroveň alertu v SQL (stejně jako `effectiveLevel`): pravidlo + zvýšení při zneužití, nejvýše 15. */
export const effLevelSql = sql<number>`least(15, ${alertSuggestions.ruleLevel} + case when coalesce((${alertSuggestions.exposure}->>'exploit')::boolean, false) then ${EXPLOIT_BUMP} else 0 end)`;

/** CVE zmíněné v alertu (popis, název, vzorek z Wazuhu). */
export function cvesOf(a: Pick<Row, "description" | "title" | "sample">): string[] {
  const text = [a.description, a.title ?? "", JSON.stringify(a.sample ?? {})].join(" ");
  return [...new Set((text.match(CVE_RE) ?? []).map((x) => x.toUpperCase()))];
}

/** Expozice pro jeden alert podle otevřených zranitelností jeho aktiva (bez aktiva = null). */
export function exposureFor(a: Pick<Row, "description" | "title" | "sample" | "mitreIds">, vulns: { cve: string; severity: string }[]): SocExposure | null {
  if (!vulns.length) return null;
  const open = new Set(vulns.map((v) => v.cve.toUpperCase()));
  const high = vulns.filter((v) => v.severity === "critical" || v.severity === "high").map((v) => v.cve.toUpperCase());
  const matched = cvesOf(a).filter((c) => open.has(c));
  const exploitTech = a.mitreIds.some((m) => EXPLOIT_TECHNIQUES.includes(m.split(".")[0]!));
  if (matched.length) return { exploit: true, reason: "cve_match", cves: matched.slice(0, 10), highVulns: high.length };
  if (exploitTech && high.length) return { exploit: true, reason: "exploit_technique", cves: [...new Set(high)].slice(0, 5), highVulns: high.length };
  if (high.length) return { exploit: false, reason: "vulnerable_asset", cves: [...new Set(high)].slice(0, 5), highVulns: high.length };
  return null;
}

/**
 * Přepočet expozice otevřených alertů s aktivem (volitelně jen zadané alerty). Vrací počet změněných.
 * Jeden dotaz na zranitelnosti pro všechna aktiva – žádné dotazy v cyklu kromě zápisu změn.
 */
export async function refreshExposure(db: Db, alertIds?: string[]): Promise<number> {
  const rows = await db
    .select()
    .from(alertSuggestions)
    .where(and(isNotNull(alertSuggestions.assetId), inArray(alertSuggestions.status, [...SOC_OPEN_STATUSES]), alertIds?.length ? inArray(alertSuggestions.id, alertIds) : undefined));
  if (!rows.length) return 0;
  const assetIds = [...new Set(rows.map((r) => r.assetId!))];
  const vulns = await db
    .select({ assetId: assetVulnerabilities.assetId, cve: assetVulnerabilities.cveId, severity: assetVulnerabilities.severity })
    .from(assetVulnerabilities)
    .where(and(inArray(assetVulnerabilities.assetId, assetIds), eq(assetVulnerabilities.status, "open")));
  const byAsset = new Map<string, { cve: string; severity: string }[]>();
  for (const v of vulns) byAsset.set(v.assetId, [...(byAsset.get(v.assetId) ?? []), { cve: v.cve, severity: v.severity }]);
  let changed = 0;
  for (const r of rows) {
    const next = exposureFor(r, byAsset.get(r.assetId!) ?? []);
    if (JSON.stringify(next) === JSON.stringify(r.exposure ?? null)) continue;
    await db.update(alertSuggestions).set({ exposure: next }).where(eq(alertSuggestions.id, r.id));
    changed++;
  }
  return changed;
}
