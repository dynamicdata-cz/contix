import { z } from "zod";

/* ============================================================
 * Prioritizace zranitelností (v0.54, ADR-049): veřejné zdroje hrozeb – katalog CISA KEV (aktivně zneužívané
 * zranitelnosti) a EPSS (pravděpodobnost zneužití v příštích 30 dnech) – a priorita P1–P4 z nich,
 * ze závažnosti a z kritičnosti aktiva. Do CONTIXu se data jen stahují, nic se neodesílá.
 * ============================================================ */

export const VULN_PRIORITIES = ["p1", "p2", "p3", "p4"] as const;
export type VulnPriority = (typeof VULN_PRIORITIES)[number];

/** Prahy EPSS (pravděpodobnost 0–1). */
export const EPSS_P1 = 0.5;
export const EPSS_P2 = 0.1;

export type VulnPriorityReason = "kev" | "kev_ransomware" | "epss_high" | "epss_medium" | "critical_on_critical_asset" | "exposed" | "severity" | "low";

/**
 * Priorita zranitelnosti (počítá se při čtení; stejná pravidla v SQL `vulnPrioritySql`):
 * P1 = v katalogu KEV nebo EPSS ≥ 50 %; P2 = EPSS ≥ 10 %, kritická na aktivu vysoké / kritické kritičnosti
 * nebo kritická / vysoká dosažitelná z internetu (aktivum vystavené do internetu nebo nález z externího skenu, ADR-095);
 * P3 = ostatní kritické a vysoké; P4 = střední a nízké.
 */
export function vulnPriority(v: { severity: string; kev: boolean; kevRansomware?: boolean; epss: number | null; assetCriticality?: string | null; exposed?: boolean }): { priority: VulnPriority; reasons: VulnPriorityReason[] } {
  const reasons: VulnPriorityReason[] = [];
  if (v.kev) reasons.push(v.kevRansomware ? "kev_ransomware" : "kev");
  if (v.epss != null && v.epss >= EPSS_P1) reasons.push("epss_high");
  if (reasons.length) return { priority: "p1", reasons };
  if (v.epss != null && v.epss >= EPSS_P2) reasons.push("epss_medium");
  if (v.severity === "critical" && (v.assetCriticality === "high" || v.assetCriticality === "critical")) reasons.push("critical_on_critical_asset");
  if (v.exposed && (v.severity === "critical" || v.severity === "high")) reasons.push("exposed");
  if (reasons.length) return { priority: "p2", reasons };
  if (v.severity === "critical" || v.severity === "high") return { priority: "p3", reasons: ["severity"] };
  return { priority: "p4", reasons: ["low"] };
}

/* ---------- lhůty oprav (v0.55, ADR-050) ---------- */

const slaDays = z.number().int().min(1).max(730).nullable();
/** Lhůta opravy ve dnech podle priority (null = bez lhůty). */
export const VulnSlaSchema = z.object({ p1: slaDays, p2: slaDays, p3: slaDays, p4: slaDays });
export type VulnSla = z.infer<typeof VulnSlaSchema>;
export const VULN_SLA_DEFAULTS: VulnSla = { p1: 7, p2: 30, p3: 90, p4: null };
/** Priority, ze kterých vznikají povinnosti a upozornění (tisíce P3 by je zahltily). */
export const VULN_OBLIGATION_PRIORITIES: VulnPriority[] = ["p1", "p2"];

/**
 * Termín opravy: od prvního zjištění; u zranitelnosti z katalogu KEV nejdřív od data zařazení do katalogu
 * (když se stará CVE dostane do KEV, lhůta P1 běží ode dne zařazení). Vrací datum RRRR-MM-DD nebo null.
 */
export function vulnDue(firstSeenAt: string | Date, priority: VulnPriority, kevDateAdded: string | null, sla: VulnSla): string | null {
  const days = sla[priority];
  if (days == null) return null;
  const first = new Date(firstSeenAt);
  const kev = kevDateAdded ? new Date(`${kevDateAdded}T00:00:00Z`) : null;
  const start = kev && kev > first ? kev : first;
  return new Date(start.getTime() + days * 864e5).toISOString().slice(0, 10);
}

/* ---------- zdroje ---------- */

export const DEFAULT_KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
export const DEFAULT_EPSS_URL = "https://epss.cyentia.com/epss_scores-current.csv.gz";

export const VulnIntelSettingsInput = z.object({
  /** Denní stažení KEV a EPSS plánovačem (server musí mít přístup na internet; jinak ruční nahrání souborů). */
  autoRefresh: z.boolean().optional(),
  kevUrl: z.string().trim().url().max(500).optional(),
  epssUrl: z.string().trim().url().max(500).optional(),
  sla: VulnSlaSchema.optional(),
});
export type VulnIntelSettingsInput = z.input<typeof VulnIntelSettingsInput>;

export interface VulnIntelStatusDto {
  autoRefresh: boolean;
  kevUrl: string;
  epssUrl: string;
  kevUpdatedAt: string | null;
  epssUpdatedAt: string | null;
  /** Verze katalogu KEV / datum skóre EPSS ze zdroje. */
  kevVersion: string | null;
  epssDate: string | null;
  kevEntries: number;
  epssEntries: number;
  lastError: string | null;
  sla: VulnSla;
}

/* ---------- plán oprav ---------- */

/** Oprava jednoho balíčku: kolik otevřených zranitelností zmizí, na kolika aktivech, s jakou prioritou. */
export interface VulnFixPlanItem {
  packageName: string;
  assets: number;
  assetNames: string[];
  versions: string[];
  cves: number;
  byPriority: Record<VulnPriority, number>;
  kev: number;
  maxEpss: number | null;
  critical: number;
  /** Ukázka nejprioritnějších CVE. */
  sample: { cveId: string; priority: VulnPriority; kev: boolean; epss: number | null }[];
  /** Kritické a vysoké otevřené zranitelnosti balíčku, které ještě nejsou navázané na riziko. */
  unlinked: number;
}

export const VULN_INTEL_LABELS = {
  priority: { p1: "P1 – okamžitě", p2: "P2 – brzy", p3: "P3 – plánovaně", p4: "P4 – sledovat" } as Record<VulnPriority, string>,
  priorityShort: { p1: "P1", p2: "P2", p3: "P3", p4: "P4" } as Record<VulnPriority, string>,
  reason: {
    kev: "Aktivně zneužívaná (CISA KEV)",
    kev_ransomware: "Zneužívaná ransomwarem (CISA KEV)",
    epss_high: "Vysoká pravděpodobnost zneužití (EPSS ≥ 50 %)",
    epss_medium: "Zvýšená pravděpodobnost zneužití (EPSS ≥ 10 %)",
    critical_on_critical_asset: "Kritická zranitelnost na kritickém aktivu",
    exposed: "Kritická / vysoká a dosažitelná z internetu",
    severity: "Kritická / vysoká závažnost",
    low: "Střední / nízká závažnost",
  } as Record<VulnPriorityReason, string>,
};

/* ---------- parsování zdrojů (sdílené pro stažení i ruční nahrání) ---------- */

export interface KevEntry {
  cveId: string;
  name: string | null;
  dateAdded: string | null;
  dueDate: string | null;
  ransomware: boolean;
}

/** Katalog CISA KEV (JSON: { catalogVersion, vulnerabilities: [{ cveID, vulnerabilityName, dateAdded, dueDate, knownRansomwareCampaignUse }] }). */
export function parseKev(text: string): { version: string | null; entries: KevEntry[] } {
  const j = JSON.parse(text) as { catalogVersion?: unknown; vulnerabilities?: unknown };
  if (!j || !Array.isArray(j.vulnerabilities)) throw new Error("Soubor není katalog CISA KEV (chybí pole vulnerabilities).");
  const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
  const entries: KevEntry[] = [];
  for (const x of j.vulnerabilities as Record<string, unknown>[]) {
    const id = String(x?.cveID ?? "").trim().toUpperCase();
    if (!/^CVE-\d{4}-\d{4,7}$/.test(id)) continue;
    entries.push({
      cveId: id,
      name: typeof x.vulnerabilityName === "string" ? x.vulnerabilityName.slice(0, 500) : null,
      dateAdded: day(x.dateAdded),
      dueDate: day(x.dueDate),
      ransomware: String(x.knownRansomwareCampaignUse ?? "").toLowerCase() === "known",
    });
  }
  return { version: typeof j.catalogVersion === "string" ? j.catalogVersion.slice(0, 50) : null, entries };
}

/**
 * EPSS (CSV: volitelný řádek `#model_version:…,score_date:…`, hlavička `cve,epss,percentile`).
 * `only` = zajímavé CVE (z evidence) – ostatní řádky se přeskočí, soubor má stovky tisíc řádků.
 */
export function parseEpss(text: string, only?: Set<string>): { date: string | null; scores: { cveId: string; epss: number; percentile: number | null }[] } {
  let date: string | null = null;
  let iCve = 0,
    iEpss = 1,
    iPct = 2;
  const scores: { cveId: string; epss: number; percentile: number | null }[] = [];
  let header = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      date = line.match(/score_date:(\d{4}-\d{2}-\d{2})/)?.[1] ?? date;
      continue;
    }
    const cols = line.split(",");
    if (!header && /cve/i.test(cols[0] ?? "") && !/^CVE-\d/i.test(cols[0] ?? "")) {
      header = true;
      const h = cols.map((c) => c.trim().toLowerCase());
      iCve = h.indexOf("cve");
      iEpss = h.indexOf("epss");
      iPct = h.indexOf("percentile");
      if (iCve < 0 || iEpss < 0) throw new Error("Soubor není EPSS (chybí sloupce cve a epss).");
      continue;
    }
    const id = (cols[iCve] ?? "").trim().toUpperCase();
    if (!/^CVE-\d{4}-\d{4,7}$/.test(id) || (only && !only.has(id))) continue;
    const e = Number(cols[iEpss]);
    if (!Number.isFinite(e) || e < 0 || e > 1) continue;
    const p = iPct >= 0 ? Number(cols[iPct]) : NaN;
    scores.push({ cveId: id, epss: e, percentile: Number.isFinite(p) ? p : null });
  }
  if (!header) throw new Error("Soubor není EPSS (chybí hlavička cve,epss,percentile).");
  return { date, scores };
}
