/* ============================================================
 * Shoda konfigurace – Wazuh SCA (v0.69, ADR-064): výsledky Security Configuration Assessment
 * (CIS benchmarky a další politiky) za aktivum, kontroly s odkazy na rámce (CIS, NIST, ISO 27001, PCI DSS…),
 * automatický test opatření podle skóre shody. Jen čtení z Wazuh API.
 * ============================================================ */

export const SCA_RESULTS = ["passed", "failed", "not_applicable"] as const;
export type ScaResult = (typeof SCA_RESULTS)[number];

/** Výsledek kontroly z Wazuhu (4.x „result“, starší „status“ / „reason“). */
export function scaResultOf(c: { result?: unknown; status?: unknown }): ScaResult {
  const v = String(c.result ?? c.status ?? "").toLowerCase();
  if (v === "passed" || v === "pass") return "passed";
  if (v === "failed" || v === "fail") return "failed";
  return "not_applicable";
}

/** Skóre shody (%) = splněné / (splněné + nesplněné); null = nic k vyhodnocení. */
export function scaScore(pass: number, fail: number): number | null {
  return pass + fail ? Math.round((pass / (pass + fail)) * 100) : null;
}

/** Výsledek automatického testu opatření podle skóre (ADR-064). */
export function scaTestResult(score: number | null, minScore: number, warnScore: number): "effective" | "effective_with_exceptions" | "ineffective" {
  if (score == null) return "ineffective";
  if (score >= minScore) return "effective";
  if (score >= warnScore) return "effective_with_exceptions";
  return "ineffective";
}

export interface ScaPolicyResultDto {
  assetId: string;
  assetName: string;
  agentId: string;
  policyId: string;
  policyName: string;
  pass: number;
  fail: number;
  na: number;
  score: number | null;
  scannedAt: string | null;
}

export interface ScaPolicySummary {
  policyId: string;
  policyName: string;
  assets: number;
  pass: number;
  fail: number;
  score: number | null;
  /** Nejhorší aktiva. */
  worst: { assetId: string; assetName: string; score: number | null }[];
}

export interface ScaFailedCheck {
  policyId: string;
  checkId: number;
  title: string;
  /** Na kolika aktivech kontrola selhala. */
  failedOn: number;
  assets: { id: string; name: string }[];
  compliance: Record<string, string[]>;
}

export interface ScaOverviewDto {
  lastSync: { at: string; agents: number; policies: number; checks: number; error: string | null } | null;
  totals: { assets: number; pass: number; fail: number; score: number | null };
  policies: ScaPolicySummary[];
  /** Nejčastěji selhávající kontroly. */
  topFailed: ScaFailedCheck[];
}

export interface ScaCheckDto {
  policyId: string;
  checkId: number;
  title: string;
  description: string | null;
  rationale: string | null;
  remediation: string | null;
  result: ScaResult;
  compliance: Record<string, string[]>;
}

export interface ScaAssetDto {
  assetId: string;
  policies: (ScaPolicyResultDto & { checks: ScaCheckDto[] })[];
}

/** Popisky rámců v poli `compliance` politik Wazuhu. */
export const SCA_COMPLIANCE_LABELS: Record<string, string> = {
  cis: "CIS Benchmark",
  cis_csc: "CIS Controls",
  cis_csc_v7: "CIS Controls v7",
  cis_csc_v8: "CIS Controls v8",
  "iso_27001-2013": "ISO/IEC 27001:2013",
  "iso_27001-2022": "ISO/IEC 27001:2022",
  nist_sp_800_53: "NIST SP 800-53",
  "nist_sp_800-53": "NIST SP 800-53",
  pci_dss: "PCI DSS",
  "pci_dss_v4.0": "PCI DSS v4.0",
  hipaa: "HIPAA",
  soc_2: "SOC 2",
  gdpr_IV: "GDPR",
  mitre_techniques: "MITRE ATT&CK",
  mitre_tactics: "MITRE ATT&CK (taktiky)",
};

export const SCA_LABELS = {
  result: { passed: "Splněno", failed: "Nesplněno", not_applicable: "Nevztahuje se" } as Record<ScaResult, string>,
};
