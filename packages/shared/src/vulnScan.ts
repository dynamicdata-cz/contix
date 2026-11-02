import { z } from "zod";
import type { Severity } from "./vuln";

/* ============================================================
 * Import výstupů skenerů zranitelností (v1.00, ADR-095) – inspirace DefectDojo:
 * import / reimport skenu (engagement → test), deduplikace, životní cyklus nálezu (zmizelý = vyřešený,
 * znovu nalezený = znovu otevřený), stavy triáže (ověřeno, falešně pozitivní, mimo rozsah, duplicita).
 * Soubor se zpracuje jen na serveru, nic se neodesílá.
 * ============================================================ */

export const VULN_SCANNERS = ["nessus", "openvas", "qualys", "burp", "zap", "nuclei", "trivy", "grype", "dependency_track", "sarif", "csv", "defectdojo"] as const;
export type VulnScanner = (typeof VULN_SCANNERS)[number];

/** Nález ze skeneru normalizovaný pro zápis do evidence zranitelností. */
export interface ScanFinding {
  /** Cíl skenu: jméno / FQDN / IP hostitele nebo artefakt (obraz, repozitář). Prázdné = cílové aktivum z formuláře. */
  host: string;
  ip: string | null;
  /** Stálé ID pravidla skeneru (plugin, šablona, pravidlo SARIF, CVE u SCA). */
  ruleId: string;
  cves: string[];
  title: string;
  severity: Severity;
  /** Informativní nález (Nessus 0, ZAP 0, SARIF note…) – ve výchozím stavu se přeskočí. */
  info: boolean;
  cvss: number | null;
  cwe: number | null;
  packageName: string;
  packageVersion: string;
  fixedVersion: string | null;
  /** Port / URL / soubor:řádek. */
  endpoint: string;
  description: string | null;
  remediation: string | null;
  reference: string | null;
}

/** Stavy triáže (DefectDojo): ruční rozhodnutí, která reimport nepřepíše. */
export const VULN_TRIAGE_ACTIONS = ["verify", "unverify", "false_positive", "out_of_scope", "duplicate", "reopen"] as const;
export type VulnTriageAction = (typeof VULN_TRIAGE_ACTIONS)[number];

export const VulnTriageInput = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(500),
    action: z.enum(VULN_TRIAGE_ACTIONS),
    reason: z.string().trim().max(2000).optional(),
    duplicateOfId: z.string().uuid().optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.action === "false_positive" || v.action === "out_of_scope") && (v.reason ?? "").length < 5)
      ctx.addIssue({ code: "custom", path: ["reason"], message: "Uveďte zdůvodnění (min. 5 znaků)" });
    if (v.action === "duplicate" && !v.duplicateOfId) ctx.addIssue({ code: "custom", path: ["duplicateOfId"], message: "Vyberte původní nález" });
  });
export type VulnTriageInput = z.input<typeof VulnTriageInput>;

/** Volby importu (pole formuláře multipart vedle souboru). */
export const VulnScanImportOptions = z.object({
  scanner: z.enum(VULN_SCANNERS).optional(),
  name: z.string().trim().max(200).optional(),
  /** Všechny nálezy na jedno aktivum (obraz kontejneru, repozitář, aplikace). */
  assetId: z.string().uuid().optional(),
  /** Reimport: nálezy téhož skeneru na skenovaných aktivech, které v souboru chybí, se označí jako vyřešené. */
  closeMissing: z.boolean().default(true),
  /** Sken zvenku (z internetu) – nálezy jsou dosažitelné z internetu a mají vyšší prioritu. */
  external: z.boolean().default(false),
  includeInfo: z.boolean().default(false),
  mode: z.enum(["preview", "commit"]).default("preview"),
});
export type VulnScanImportOptions = z.input<typeof VulnScanImportOptions>;

export interface VulnScanStats {
  findings: number;
  skippedInfo: number;
  unmatched: number;
  created: number;
  updated: number;
  reopened: number;
  closed: number;
  duplicates: number;
}

export interface VulnScanHostDto {
  host: string;
  ip: string | null;
  findings: number;
  assetId: string | null;
  assetName: string | null;
}

export interface VulnScanPreviewDto {
  scanner: VulnScanner;
  findings: number;
  skippedInfo: number;
  bySeverity: Record<Severity, number>;
  hosts: VulnScanHostDto[];
  sample: { title: string; ruleId: string; severity: Severity; host: string; endpoint: string; cves: string[] }[];
}

export interface VulnScanDto {
  id: string;
  companyId: string;
  scanner: VulnScanner;
  name: string;
  fileName: string;
  external: boolean;
  closeMissing: boolean;
  assetId: string | null;
  assetName: string | null;
  stats: VulnScanStats;
  unmatchedHosts: string[];
  importedAt: string;
  importedByName: string | null;
  /** Aktuálně otevřené nálezy z tohoto importu. */
  open: number;
}

/** CVSS → závažnost (rozsahy CVSS v3). */
export function severityFromCvss(score: number | null | undefined): Severity {
  if (score == null || !Number.isFinite(score)) return "unknown";
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  if (score > 0) return "low";
  return "unknown";
}

/** Textová závažnost ze skenerů (Critical, HIGH, error, Information…) → závažnost a příznak informativního nálezu. */
export function severityFromText(s: unknown): { severity: Severity; info: boolean } {
  const v = String(s ?? "").trim().toLowerCase();
  if (["critical", "crit", "urgent", "4"].includes(v)) return { severity: "critical", info: false };
  if (["high", "error", "serious", "3"].includes(v)) return { severity: "high", info: false };
  if (["medium", "moderate", "warning", "2"].includes(v)) return { severity: "medium", info: false };
  if (["low", "minor", "note", "negligible", "1"].includes(v)) return { severity: "low", info: false };
  if (["info", "informational", "information", "none", "log", "0"].includes(v)) return { severity: "unknown", info: true };
  return { severity: "unknown", info: false };
}

const CVE_RE = /CVE-\d{4}-\d{4,7}/gi;
/** CVE z libovolného textu / pole (seřazené, bez duplicit). */
export function cvesIn(...vals: unknown[]): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (v == null) return;
    if (Array.isArray(v)) return v.forEach(walk);
    for (const m of String(v).matchAll(CVE_RE)) out.add(m[0].toUpperCase());
  };
  vals.forEach(walk);
  return [...out].sort();
}

/** CWE z textu („CWE-79“, „external/cwe/cwe-079“, 79). */
export function cweOf(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isInteger(v) && v > 0 && v < 100000 ? v : null;
  const m = String(v).match(/cwe[-_/ ]?0*(\d{1,5})/i) ?? String(v).match(/^0*(\d{1,5})$/);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Reprezentativní CVE nálezu s více CVE (podle ní se počítá priorita KEV / EPSS): nejdřív v katalogu KEV,
 * pak nejvyšší EPSS, pak první. Bez CVE = ID pravidla skeneru.
 */
export function representativeId(f: Pick<ScanFinding, "cves" | "ruleId">, scanner: VulnScanner, intel: Map<string, { kev: boolean; epss: number | null }>): string {
  if (!f.cves.length) return (/^(GHSA|OSV|RUSTSEC|PYSEC|GO|SNYK|ALSA|RHSA|DSA|USN)-/i.test(f.ruleId) ? f.ruleId : `${scanner}:${f.ruleId}`).slice(0, 100);
  const score = (c: string) => {
    const i = intel.get(c);
    return (i?.kev ? 10 : 0) + (i?.epss ?? 0);
  };
  return [...f.cves].sort((a, b) => score(b) - score(a) || a.localeCompare(b))[0]!;
}

/** Je ID zranitelnosti CVE (odkaz na NVD / detail CVE)? */
export const isCveId = (id: string) => /^CVE-\d{4}-\d{4,7}$/i.test(id);

export const VULN_SCAN_LABELS = {
  scanner: {
    nessus: "Tenable Nessus (.nessus)",
    openvas: "OpenVAS / Greenbone (XML)",
    burp: "Burp Suite (XML)",
    zap: "OWASP ZAP (JSON)",
    nuclei: "Nuclei (JSON / JSONL)",
    trivy: "Trivy (JSON)",
    grype: "Grype (JSON)",
    sarif: "SARIF (Semgrep, CodeQL, SonarQube…)",
    csv: "Obecné CSV",
    qualys: "Qualys VMDR (XML)",
    dependency_track: "Dependency-Track (FPF JSON)",
    defectdojo: "DefectDojo (konektor)",
  } satisfies Record<VulnScanner, string>,
  triage: {
    verify: "Ověřit",
    unverify: "Zrušit ověření",
    false_positive: "Falešně pozitivní",
    out_of_scope: "Mimo rozsah",
    duplicate: "Duplicita",
    reopen: "Znovu otevřít",
  } satisfies Record<VulnTriageAction, string>,
} as const;

/* ---------- metriky správy zranitelností (v1.02, ADR-097) ---------- */

export const VulnMetricsQuery = z.object({ months: z.coerce.number().int().min(3).max(24).default(12) });

export interface VulnMetricsDto {
  /** Měsíční vývoj: nově zjištěné, vyřešené a otevřené na konci měsíce. */
  months: { month: string; opened: number; closed: number; open: number }[];
  /** Průměrná doba opravy (dny) zranitelností vyřešených v období, podle závažnosti. */
  mttr: Record<Severity, { days: number | null; n: number }>;
  /** Stáří otevřených zranitelností podle závažnosti. */
  aging: Record<Severity, { d30: number; d90: number; d180: number; older: number }>;
  /** Dodržení lhůt oprav u vyřešených v období (podle aktuální priority) a otevřené po termínu. */
  sla: { resolved: number; inTime: number; pct: number | null; openOverdue: number };
  bySource: { source: string; open: number; resolved90: number }[];
  triage: { falsePositive: number; outOfScope: number; duplicate: number; verified: number };
}

/** Podíl v % zaokrouhlený na celé číslo (null bez populace). */
export const pctOf = (part: number, all: number) => (all ? Math.round((part / all) * 100) : null);

/* ---------- konektor DefectDojo (v1.02, ADR-097) – jen čtení přes API v2 ---------- */

export const DefectDojoSettingsInput = z.object({
  enabled: z.boolean().optional(),
  url: z.string().trim().url().max(500).optional(),
  /** API v2 klíč (Token …) – ukládá se šifrovaně, nikdy se nevrací. Prázdné = ponechat. */
  apiKey: z.string().trim().min(10).max(200).optional(),
  companyId: z.string().uuid().optional(),
  intervalHours: z.number().int().min(1).max(168).optional(),
  /** Jen ověřené nálezy (verified=true). */
  verifiedOnly: z.boolean().optional(),
  /** Nálezy produktu bez endpointu (SAST, SCA) přiřadit aktivu podle názvu produktu DefectDojo. */
  productAsAsset: z.boolean().optional(),
});
export type DefectDojoSettingsInput = z.input<typeof DefectDojoSettingsInput>;

export interface DefectDojoStatusDto {
  enabled: boolean;
  url: string;
  hasKey: boolean;
  companyId: string | null;
  intervalHours: number;
  verifiedOnly: boolean;
  productAsAsset: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  lastStats: VulnScanStats | null;
  lastScanId: string | null;
}
