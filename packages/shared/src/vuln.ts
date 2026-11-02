import { z } from "zod";
import { VULN_PRIORITIES, type VulnIntelStatusDto, type VulnPriority, type VulnPriorityReason } from "./vulnIntel";

/* ============================================================
 * Zranitelnosti (CVE) a zdravotní stav aktiv – "semafor"
 * ============================================================ */

export const SEVERITIES = ["critical", "high", "medium", "low", "unknown"] as const;
export const Severity = z.enum(SEVERITIES);
export type Severity = z.infer<typeof Severity>;

/** Stavy nálezu; false_positive / out_of_scope / duplicate = triáž (ADR-095), reimport je nepřepíše. */
export const VULN_STATUSES = ["open", "accepted", "resolved", "false_positive", "out_of_scope", "duplicate"] as const;
export const VulnStatus = z.enum(VULN_STATUSES);
export type VulnStatus = z.infer<typeof VulnStatus>;

export const HEALTH_STATUSES = ["green", "orange", "red", "unknown"] as const;
export const HealthStatus = z.enum(HEALTH_STATUSES);
export type HealthStatus = z.infer<typeof HealthStatus>;

export const SUPPORT_STATUSES = ["supported", "ending", "eol", "unknown"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const VULN_LABELS = {
  severity: { critical: "Kritická", high: "Vysoká", medium: "Střední", low: "Nízká", unknown: "Neurčeno" } satisfies Record<Severity, string>,
  status: { open: "Otevřená", accepted: "Akceptovaná (výjimka)", resolved: "Vyřešená", false_positive: "Falešně pozitivní", out_of_scope: "Mimo rozsah", duplicate: "Duplicita" } satisfies Record<VulnStatus, string>,
  health: { green: "V pořádku", orange: "Pozor", red: "Kritické", unknown: "Bez dat" } satisfies Record<HealthStatus, string>,
  support: {
    supported: "Podporováno",
    ending: "Podpora brzy končí",
    eol: "Bez podpory (EOL)",
    unknown: "Neznámé",
  } satisfies Record<SupportStatus, string>,
} as const;

/** Pravidla semaforu – nastavitelná v Administraci → Nastavení. */
export const HealthPolicySchema = z.object({
  /** Červená při alespoň N kritických CVE. */
  redCritical: z.number().int().min(1).max(1000).default(1),
  /** Červená při alespoň N vysokých CVE (0 = nepoužívat). */
  redHigh: z.number().int().min(0).max(1000).default(10),
  /** Oranžová při alespoň N vysokých CVE. */
  orangeHigh: z.number().int().min(1).max(1000).default(1),
  /** Oranžová při alespoň N středních CVE (0 = nepoužívat). */
  orangeMedium: z.number().int().min(0).max(10000).default(10),
  /** Červená, pokud OS/produkt nemá podporu výrobce (EOL). */
  redOnEol: z.boolean().default(true),
  /** Oranžová, pokud podpora skončí do N dní. */
  eolWarnDays: z.number().int().min(0).max(3650).default(180),
  /** Oranžová, pokud aktivum nebylo viděno N dní (zastaralá data). 0 = nepoužívat. */
  staleDays: z.number().int().min(0).max(3650).default(14),
  /** Červená při otevřené zranitelnosti priority P1 (katalog KEV nebo EPSS ≥ 50 %, ADR-050). */
  redOnP1: z.boolean().default(true),
  /** Primární aktivum přebírá nejhorší stav svých podpůrných aktiv. */
  propagateToPrimary: z.boolean().default(true),
});
export type HealthPolicy = z.infer<typeof HealthPolicySchema>;

export interface HealthReason {
  level: "red" | "orange";
  code: "critical_cve" | "high_cve" | "medium_cve" | "p1_cve" | "eol" | "eol_soon" | "stale" | "supporting";
  text: string;
}

export interface VulnCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface VulnerabilityDto {
  id: string;
  assetId: string;
  assetName?: string;
  cveId: string;
  severity: Severity;
  cvssScore: number | null;
  packageName: string | null;
  packageVersion: string | null;
  description: string | null;
  reference: string | null;
  publishedAt: string | null;
  detectedAt: string | null;
  status: VulnStatus;
  acceptedReason: string | null;
  acceptedUntil: string | null;
  acceptedByName?: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  /* prioritizace (v0.54, ADR-049) */
  kev: boolean;
  kevRansomware: boolean;
  kevDateAdded: string | null;
  epss: number | null;
  epssPercentile: number | null;
  priority: VulnPriority;
  priorityReasons: VulnPriorityReason[];
  /** Termín opravy podle priority (ADR-050); null = bez lhůty nebo není otevřená. */
  due: string | null;
  overdue: boolean;
  /* import skenů a triáž (v1.00, ADR-095) */
  title: string | null;
  cwe: number | null;
  endpoint: string;
  scanner: string;
  scanId: string | null;
  relatedCves: string[];
  fixedVersion: string | null;
  remediation: string | null;
  verified: boolean;
  exposed: boolean;
  duplicateOfId: string | null;
  triageReason: string | null;
}

export const VulnListQuery = z.object({
  assetId: z.string().uuid().optional(),
  severity: Severity.optional(),
  status: VulnStatus.optional(),
  q: z.string().optional(),
  priority: z.enum(VULN_PRIORITIES).optional(),
  kev: z.literal("1").optional(),
  packageName: z.string().max(500).optional(),
  overdue: z.literal("1").optional(),
  scanId: z.string().uuid().optional(),
  scanner: z.string().max(30).optional(),
  verified: z.literal("1").optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const AcceptVulnInput = z.object({
  reason: z.string().trim().min(5, "Uveďte zdůvodnění výjimky (min. 5 znaků)").max(2000),
  until: z.string().date().optional().nullable(),
});
export type AcceptVulnInput = z.input<typeof AcceptVulnInput>;

export interface VulnSummaryDto {
  health: Record<HealthStatus, number>;
  support: Record<SupportStatus, number>;
  openBySeverity: VulnCounts & { unknown: number };
  accepted: number;
  topAssets: { id: string; name: string; healthStatus: HealthStatus; critical: number; high: number; medium: number; low: number }[];
  topPackages: { name: string; assets: number; critical: number; high: number; medium: number; low: number }[];
  topCves: { cveId: string; severity: Severity; cvssScore: number | null; assets: number; packageName: string | null }[];
  eolAssets: { id: string; name: string; osName: string | null; osVersion: string | null; eolDate: string | null; supportStatus: SupportStatus }[];
  lastSync: string | null;
  /** Otevřené zranitelnosti podle priority (ADR-049) a z toho v katalogu KEV. */
  openByPriority: Record<VulnPriority, number>;
  kevOpen: number;
  /** Otevřené zranitelnosti po termínu opravy. */
  overdue: number;
  intel: VulnIntelStatusDto;
}

/* ============================================================
 * Konec podpory OS (EOL) – vestavěná orientační tabulka.
 * Data odpovídají veřejným lifecycle politikám výrobců (standardní / bezpečnostní podpora,
 * bez placených rozšíření typu ESU/ESM/ELS). Před auditním použitím ověřte u výrobce
 * nebo na https://endoflife.date – tabulku lze rozšiřovat.
 * ============================================================ */

interface EolRule {
  match: RegExp;
  product: string;
  /** Vrátí datum EOL (YYYY-MM-DD) podle verze, nebo null, pokud verzi neznáme. */
  eol: (name: string, version: string) => string | null;
}

const byMajor = (table: Record<string, string>) => (_: string, v: string) => {
  const m = v.match(/^(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return table[`${m[1]}.${m[2] ?? "0"}`] ?? table[m[1]!] ?? null;
};

export const EOL_RULES: EolRule[] = [
  {
    match: /windows server/i,
    product: "Windows Server",
    eol: (name) => {
      const t: [RegExp, string][] = [
        [/2008/, "2020-01-14"],
        [/2012/, "2023-10-10"],
        [/2016/, "2027-01-12"],
        [/2019/, "2029-01-09"],
        [/2022/, "2031-10-14"],
        [/2025/, "2034-10-10"],
      ];
      return t.find(([r]) => r.test(name))?.[1] ?? null;
    },
  },
  {
    match: /windows/i,
    product: "Windows",
    eol: (name) => {
      if (/windows 7\b/i.test(name)) return "2020-01-14";
      if (/windows 8\.1/i.test(name)) return "2023-01-10";
      if (/windows 10/i.test(name)) return /ltsc|ltsb|enterprise ltsc/i.test(name) ? null : "2025-10-14";
      return null; // Windows 11 – závisí na feature release, neurčujeme
    },
  },
  {
    match: /ubuntu/i,
    product: "Ubuntu",
    eol: byMajor({
      "14.04": "2019-04-30",
      "16.04": "2021-04-30",
      "18.04": "2023-05-31",
      "20.04": "2025-05-31",
      "22.04": "2027-06-01",
      "24.04": "2029-05-31",
    }),
  },
  {
    match: /debian/i,
    product: "Debian",
    // konec LTS
    eol: byMajor({ "8": "2020-06-30", "9": "2022-06-30", "10": "2024-06-30", "11": "2026-08-31", "12": "2028-06-30", "13": "2030-06-30" }),
  },
  {
    match: /centos stream/i,
    product: "CentOS Stream",
    eol: byMajor({ "8": "2024-05-31", "9": "2027-05-31" }),
  },
  { match: /centos/i, product: "CentOS", eol: byMajor({ "6": "2020-11-30", "7": "2024-06-30", "8": "2021-12-31" }) },
  {
    match: /red hat|rhel|rocky|alma|oracle linux/i,
    product: "RHEL a klony",
    eol: byMajor({ "6": "2020-11-30", "7": "2024-06-30", "8": "2029-05-31", "9": "2032-05-31" }),
  },
  {
    match: /mac ?os|darwin/i,
    product: "macOS",
    eol: byMajor({ "10.15": "2022-09-12", "11": "2023-09-26", "12": "2024-09-16", "13": "2025-09-15" }),
  },
];

export function osSupport(
  osName: string | null | undefined,
  osVersion: string | null | undefined,
  now = new Date(),
  warnDays = 180,
): { status: SupportStatus; eolDate: string | null; product: string | null } {
  const name = osName ?? "";
  if (!name.trim()) return { status: "unknown", eolDate: null, product: null };
  const rule = EOL_RULES.find((r) => r.match.test(name));
  if (!rule) return { status: "unknown", eolDate: null, product: null };
  const version = (osVersion ?? name.match(/\d+(\.\d+)?/)?.[0] ?? "").trim();
  const eol = rule.eol(name, version);
  if (!eol) return { status: rule.product === "Windows" && /windows 11/i.test(name) ? "supported" : "unknown", eolDate: null, product: rule.product };
  const days = (new Date(eol).getTime() - now.getTime()) / 86_400_000;
  return { status: days < 0 ? "eol" : days <= warnDays ? "ending" : "supported", eolDate: eol, product: rule.product };
}

/** Výpočet semaforu jednoho aktiva (čistá funkce – testovatelná). */
export function computeHealth(input: {
  counts: VulnCounts;
  /** Otevřené zranitelnosti priority P1 (ADR-050). */
  p1?: number;
  osName?: string | null;
  osVersion?: string | null;
  lastSeenAt?: Date | null;
  hasVulnData: boolean;
  policy: HealthPolicy;
  now?: Date;
}): { status: HealthStatus; reasons: HealthReason[]; support: ReturnType<typeof osSupport> } {
  const p = input.policy;
  const now = input.now ?? new Date();
  const c = input.counts;
  const reasons: HealthReason[] = [];
  const support = osSupport(input.osName, input.osVersion, now, p.eolWarnDays);

  if (p.redOnP1 !== false && (input.p1 ?? 0) > 0) reasons.push({ level: "red", code: "p1_cve", text: `${input.p1}× zranitelnost P1 (aktivně zneužívaná nebo s vysokou pravděpodobností zneužití)` });
  if (c.critical >= p.redCritical) reasons.push({ level: "red", code: "critical_cve", text: `${c.critical}× kritická zranitelnost` });
  if (p.redHigh > 0 && c.high >= p.redHigh) reasons.push({ level: "red", code: "high_cve", text: `${c.high}× vysoká zranitelnost` });
  else if (c.high >= p.orangeHigh) reasons.push({ level: "orange", code: "high_cve", text: `${c.high}× vysoká zranitelnost` });
  if (p.orangeMedium > 0 && c.medium >= p.orangeMedium) reasons.push({ level: "orange", code: "medium_cve", text: `${c.medium}× střední zranitelnost` });

  if (support.status === "eol")
    reasons.push({ level: p.redOnEol ? "red" : "orange", code: "eol", text: `${support.product} bez podpory od ${support.eolDate}` });
  else if (support.status === "ending")
    reasons.push({ level: "orange", code: "eol_soon", text: `${support.product} – podpora končí ${support.eolDate}` });

  if (p.staleDays > 0 && input.lastSeenAt && now.getTime() - input.lastSeenAt.getTime() > p.staleDays * 86_400_000) {
    const d = Math.floor((now.getTime() - input.lastSeenAt.getTime()) / 86_400_000);
    reasons.push({ level: "orange", code: "stale", text: `Aktivum nehlásí stav ${d} dní (neaktuální data)` });
  }

  const status: HealthStatus = reasons.some((r) => r.level === "red")
    ? "red"
    : reasons.some((r) => r.level === "orange")
      ? "orange"
      : input.hasVulnData || support.status === "supported"
        ? "green"
        : "unknown";
  return { status, reasons, support };
}

export const healthRank: Record<HealthStatus, number> = { unknown: 0, green: 1, orange: 2, red: 3 };
