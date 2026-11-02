import { z } from "zod";
import { CROSSWALK_409 } from "./frameworks";

/* ============================================================
 * Rizikové scénáře z dat (v1.17, ADR-114).
 * 1) Profil bezpečnostních schopností – měřený z dat CONTIXu (Wazuh, identity, zranitelnosti, SCA, segmenty, BIA a testy
 *    plánů, dodavatelé), co změřit nejde, doplní člověk jako deklaraci s důkazem. „Neznámo“ se nikdy nepočítá jako zavedené.
 * 2) Knihovna šablon scénářů (data): hrozba a zranitelnosti z katalogu vyhlášky, techniky ATT&CK, signály a schopnosti.
 * 3) Vyhodnocení `evaluateScenario` – deterministické a vysvětlitelné (žádná AI); návrh vzniká jen z doložených signálů
 *    nebo slabé schopnosti, rozhoduje vždy člověk (přijmout / navázat na existující riziko / zamítnout).
 * ============================================================ */

export const CAPABILITY_KEYS = ["edr", "mfa", "privileged_access", "segmentation", "vuln_mgmt", "hardening", "backup_recovery", "supplier_assurance"] as const;
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];
export const CAPABILITY_STATUSES = ["strong", "partial", "weak", "unknown"] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];
/** Deklarovat lze jen známý stav. */
export const DECLARED_STATUSES = ["strong", "partial", "weak"] as const;
export type CapabilityConfidence = "measured" | "declared" | "none";

/** Požadavky rámců, které schopnost naplňuje (ID požadavků v registru); vyhláška se dopočítá přes `CROSSWALK_409`. */
export const CAPABILITY_REFS: Record<CapabilityKey, { iso: string[]; nis2: string[]; cis: string[] }> = {
  edr: { iso: ["A.8.7", "A.8.16"], nis2: ["21/2/e", "21/2/g"], cis: ["10.1", "10.2", "13.2"] },
  mfa: { iso: ["A.8.5", "A.5.17"], nis2: ["21/2/j"], cis: ["6.3", "6.4", "6.5"] },
  privileged_access: { iso: ["A.8.2", "A.5.15", "A.5.18"], nis2: ["21/2/i"], cis: ["5.4", "6.8"] },
  segmentation: { iso: ["A.8.20", "A.8.22"], nis2: ["21/2/e"], cis: ["12.2", "13.4"] },
  vuln_mgmt: { iso: ["A.8.8"], nis2: ["21/2/e"], cis: ["7.1", "7.4", "7.7"] },
  hardening: { iso: ["A.8.9"], nis2: ["21/2/e"], cis: ["4.1"] },
  backup_recovery: { iso: ["A.8.13", "A.5.30"], nis2: ["21/2/c"], cis: ["11.1", "11.5"] },
  supplier_assurance: { iso: ["A.5.19", "A.5.20", "A.5.22"], nis2: ["21/2/d"], cis: ["15.1", "15.4"] },
};

/** ID požadavků rámců pro schopnost; vyhláška 409 / 410 přes crosswalk (paragrafy, jejichž mapování obsahuje ISO opatření). */
export function capabilityRequirementIds(key: CapabilityKey): { ids: string[]; decree409: string[]; decree410: string[] } {
  const r = CAPABILITY_REFS[key];
  const iso = new Set(r.iso);
  const s409 = Object.entries(CROSSWALK_409)
    .filter(([, m]) => m.iso.some((x) => iso.has(x)))
    .map(([par]) => par);
  const s410 = [...new Set(s409.flatMap((p) => CROSSWALK_409[p]!.cz410))];
  return {
    ids: [...r.iso.map((x) => `iso27001:${x}`), ...r.nis2.map((x) => `nis2:${x}`), ...r.cis.map((x) => `cis8:${x}`)],
    decree409: s409,
    decree410: s410,
  };
}

/* ---------------- signály (doložené slabiny) ---------------- */

export const SIGNAL_KEYS = [
  "no_edr",
  "kev_exposed",
  "critical_exposed",
  "vuln_overdue",
  "eol_os",
  "sca_low",
  "internet_exposed",
  "mfa_gap",
  "priv_no_mfa",
  "priv_hygiene",
  "kerberos_weak",
  "unmanaged_devices",
  "restore_untested",
  "supplier_no_assurance",
  "capability_weak",
  // v1.21 (ADR-118)
  "no_redundancy",
  "secure_score_low",
  "component_vuln",
  "ot_vulnerable",
] as const;
export type SignalKey = (typeof SIGNAL_KEYS)[number];
export const SIGNAL_META: Record<SignalKey, { capability: CapabilityKey | null; scope: "asset" | "company" | "asset_process" | "asset_supplier"; severity: 1 | 2 | 3 }> = {
  no_edr: { capability: "edr", scope: "asset", severity: 3 },
  kev_exposed: { capability: "vuln_mgmt", scope: "asset", severity: 3 },
  critical_exposed: { capability: "vuln_mgmt", scope: "asset", severity: 2 },
  vuln_overdue: { capability: "vuln_mgmt", scope: "asset", severity: 2 },
  eol_os: { capability: "vuln_mgmt", scope: "asset", severity: 2 },
  sca_low: { capability: "hardening", scope: "asset", severity: 1 },
  internet_exposed: { capability: null, scope: "asset", severity: 1 },
  mfa_gap: { capability: "mfa", scope: "company", severity: 2 },
  priv_no_mfa: { capability: "privileged_access", scope: "company", severity: 3 },
  priv_hygiene: { capability: "privileged_access", scope: "company", severity: 2 },
  kerberos_weak: { capability: "privileged_access", scope: "company", severity: 2 },
  unmanaged_devices: { capability: "segmentation", scope: "company", severity: 1 },
  restore_untested: { capability: "backup_recovery", scope: "asset_process", severity: 3 },
  supplier_no_assurance: { capability: "supplier_assurance", scope: "asset_supplier", severity: 2 },
  capability_weak: { capability: null, scope: "company", severity: 2 },
  no_redundancy: { capability: "backup_recovery", scope: "asset", severity: 2 },
  secure_score_low: { capability: "hardening", scope: "company", severity: 2 },
  component_vuln: { capability: "vuln_mgmt", scope: "asset", severity: 2 },
  ot_vulnerable: { capability: "vuln_mgmt", scope: "asset", severity: 3 },
};

/* ---------------- šablony scénářů ---------------- */

export interface ScenarioTemplate {
  key: string;
  /** Hlavní hrozba a další hrozby (kódy katalogu vyhlášky). */
  threat: string;
  moreThreats: string[];
  weaknesses: string[];
  attack: string[];
  /** Signály, které scénář dokládají (váha 1–3). */
  signals: Partial<Record<SignalKey, number>>;
  /** Schopnosti, které scénář zmírňují. */
  capabilities: CapabilityKey[];
  /** Ohrožené složky (dopad z CIA primárního aktiva). */
  cia: ("c" | "i" | "a")[];
  /** Šablona platí jen pro aktiva s těmito typy v rozsahu, resp. s aktivem dostupným z internetu (v1.21, ADR-118). */
  requires?: { assetTypes?: string[]; internetFacing?: boolean };
}

/** Platí šablona pro rozsah primárního aktiva (primární + podpůrná aktiva)? */
export function templateApplies(t: ScenarioTemplate, scope: { assetType: string; internetFacing: boolean }[]): boolean {
  if (t.requires?.assetTypes && !scope.some((a) => t.requires!.assetTypes!.includes(a.assetType))) return false;
  if (t.requires?.internetFacing && !scope.some((a) => a.internetFacing)) return false;
  return true;
}

export const SCENARIO_TEMPLATES: ScenarioTemplate[] = [
  {
    key: "ransomware",
    threat: "H05",
    moreThreats: ["H16"],
    weaknesses: ["Z05", "Z10", "Z17"],
    attack: ["T1486", "T1133", "T1078", "T1021", "T1490"],
    signals: { no_edr: 3, kev_exposed: 3, critical_exposed: 2, mfa_gap: 2, priv_no_mfa: 2, restore_untested: 3, unmanaged_devices: 1 },
    capabilities: ["edr", "mfa", "backup_recovery", "vuln_mgmt", "segmentation"],
    cia: ["i", "a"],
  },
  {
    key: "privileged_takeover",
    threat: "H03",
    moreThreats: ["H01"],
    weaknesses: ["Z06", "Z08"],
    attack: ["T1078", "T1558", "T1003", "T1098"],
    signals: { priv_no_mfa: 3, priv_hygiene: 2, kerberos_weak: 2, mfa_gap: 1, no_edr: 1 },
    capabilities: ["privileged_access", "mfa", "edr"],
    cia: ["c", "i", "a"],
  },
  {
    key: "known_vuln_exploit",
    threat: "H09",
    moreThreats: ["H05"],
    weaknesses: ["Z17", "Z02", "Z01"],
    attack: ["T1190", "T1210", "T1068"],
    signals: { kev_exposed: 3, critical_exposed: 3, vuln_overdue: 2, eol_os: 2, internet_exposed: 1, sca_low: 1 },
    capabilities: ["vuln_mgmt", "hardening", "segmentation"],
    cia: ["c", "i", "a"],
  },
  {
    key: "phishing_credentials",
    threat: "H16",
    moreThreats: ["H03", "H12"],
    weaknesses: ["Z04", "Z06"],
    attack: ["T1566", "T1078", "T1621"],
    signals: { mfa_gap: 3, priv_no_mfa: 2, no_edr: 1 },
    capabilities: ["mfa", "edr"],
    cia: ["c", "i"],
  },
  {
    key: "lateral_movement",
    threat: "H09",
    moreThreats: ["H05"],
    weaknesses: ["Z11", "Z03", "Z08"],
    attack: ["T1021", "T1570", "T1046"],
    signals: { unmanaged_devices: 2, no_edr: 2, kerberos_weak: 2, priv_hygiene: 1, sca_low: 1 },
    capabilities: ["segmentation", "edr", "privileged_access"],
    cia: ["c", "i", "a"],
  },
  {
    key: "backup_failure",
    threat: "H02",
    moreThreats: ["H05"],
    weaknesses: ["Z05"],
    attack: ["T1490", "T1485"],
    signals: { restore_untested: 3, no_edr: 1 },
    capabilities: ["backup_recovery"],
    cia: ["i", "a"],
  },
  {
    key: "supplier_outage",
    threat: "H19",
    moreThreats: ["H11"],
    weaknesses: ["Z09", "Z12"],
    attack: ["T1195", "T1199"],
    signals: { supplier_no_assurance: 3 },
    capabilities: ["supplier_assurance"],
    cia: ["c", "i", "a"],
  },
  {
    key: "data_leak_access",
    threat: "H01",
    moreThreats: ["H13", "H09"],
    weaknesses: ["Z06", "Z13"],
    attack: ["T1530", "T1567", "T1213"],
    signals: { priv_hygiene: 2, mfa_gap: 2, priv_no_mfa: 2 },
    capabilities: ["privileged_access", "mfa"],
    cia: ["c"],
  },
  // ---- v1.21 (ADR-118) ----
  {
    key: "insider_misuse",
    threat: "H01",
    moreThreats: ["H13"],
    weaknesses: ["Z06", "Z08", "Z13"],
    attack: ["T1078", "T1485", "T1565"],
    signals: { priv_hygiene: 3, kerberos_weak: 1, priv_no_mfa: 1 },
    capabilities: ["privileged_access"],
    cia: ["i", "a"],
  },
  {
    key: "ddos_outage",
    threat: "H07",
    moreThreats: ["H14", "H02"],
    weaknesses: ["Z03", "Z11"],
    attack: ["T1498", "T1499"],
    signals: { no_redundancy: 3, internet_exposed: 1, restore_untested: 1 },
    capabilities: ["backup_recovery", "segmentation"],
    cia: ["a"],
    requires: { internetFacing: true },
  },
  {
    key: "cloud_misconfig",
    threat: "H09",
    moreThreats: ["H03", "H08"],
    weaknesses: ["Z06", "Z10", "Z15"],
    attack: ["T1530", "T1078", "T1098"],
    signals: { secure_score_low: 3, mfa_gap: 2, priv_no_mfa: 2 },
    capabilities: ["hardening", "mfa", "privileged_access"],
    cia: ["c", "i"],
    requires: { assetTypes: ["cloud_resource", "saas_service"] },
  },
  {
    key: "software_supply_chain",
    threat: "H19",
    moreThreats: ["H05"],
    weaknesses: ["Z12", "Z17"],
    attack: ["T1195", "T1554"],
    signals: { component_vuln: 3, supplier_no_assurance: 2, vuln_overdue: 1 },
    capabilities: ["vuln_mgmt", "supplier_assurance"],
    cia: ["c", "i", "a"],
    requires: { assetTypes: ["application", "container", "saas_service", "database"] },
  },
  {
    key: "ot_compromise",
    threat: "H05",
    moreThreats: ["H13", "H02"],
    weaknesses: ["Z02", "Z03", "Z11"],
    attack: ["T0866", "T0883", "T0816"],
    signals: { ot_vulnerable: 3, unmanaged_devices: 2, internet_exposed: 1 },
    capabilities: ["segmentation", "vuln_mgmt"],
    cia: ["i", "a"],
    requires: { assetTypes: ["iot_ot"] },
  },
  {
    key: "device_loss",
    threat: "H10",
    moreThreats: ["H17"],
    weaknesses: ["Z10", "Z15"],
    attack: ["T1025", "T1052"],
    signals: { no_edr: 3, mfa_gap: 1 },
    capabilities: ["edr", "mfa"],
    cia: ["c"],
    requires: { assetTypes: ["laptop", "mobile_device"] },
  },
];
export const templateByKey = (k: string) => SCENARIO_TEMPLATES.find((t) => t.key === k) ?? null;

/* ---------------- vyhodnocení ---------------- */

export interface SignalHit {
  key: SignalKey;
  count: number;
  /** Odkazy na doklady (aktiva, nálezy…) – nejvýše několik. */
  items: { label: string; path: string | null }[];
}
export interface ScenarioEvaluation {
  impact: number;
  threatLevel: number;
  vulnLevel: number;
  likelihood: number;
  lowConfidence: boolean;
  reasons: { kind: "impact" | "threat" | "vuln"; text: string; params?: Record<string, string | number> }[];
}

const clamp = (v: number, n: number) => Math.min(n, Math.max(1, Math.round(v)));

/**
 * Úrovně scénáře na stupnici 1–n:
 * - dopad = nejvyšší z ohrožených složek CIA primárního aktiva (1–4 → stupnice), bez CIA podle kritičnosti;
 * - hrozba = střed stupnice, +1 za útoky stejnými technikami v SOC za 90 dní, +1 za KEV / kritickou zranitelnost vystavenou do internetu;
 * - zranitelnost = podíl vah doložených signálů a slabých schopností; bez měřených dat střed stupnice s nízkou jistotou.
 */
export function evaluateScenario(
  t: ScenarioTemplate,
  ctx: {
    levels: number;
    cia: { c: number | null; i: number | null; a: number | null };
    criticality: "low" | "medium" | "high" | "critical";
    hits: SignalHit[];
    capabilities: Partial<Record<CapabilityKey, CapabilityStatus>>;
    alerts: number;
    /** Pokrytí technik šablony detekcí (v1.22, ADR-119); null = detekce se neměří. */
    detection?: { blind: number; total: number } | null;
  },
): ScenarioEvaluation {
  const n = ctx.levels;
  const reasons: ScenarioEvaluation["reasons"] = [];
  const ciaVals = t.cia.map((k) => ctx.cia[k]).filter((x): x is number => x != null);
  const crit = { low: 1, medium: 2, high: 3, critical: 4 }[ctx.criticality];
  const base4 = ciaVals.length ? Math.max(...ciaVals) : crit;
  const impact = clamp((base4 / 4) * n, n);
  reasons.push(ciaVals.length ? { kind: "impact", text: "rsc.why.impactCia", params: { v: base4, cia: t.cia.join("").toUpperCase() } } : { kind: "impact", text: "rsc.why.impactCrit", params: { v: base4 } });

  let threat = Math.ceil(n / 2);
  if (ctx.alerts > 0) {
    threat++;
    reasons.push({ kind: "threat", text: "rsc.why.alerts", params: { n: ctx.alerts } });
  }
  if (ctx.hits.some((h) => (h.key === "kev_exposed" || h.key === "critical_exposed") && h.count > 0)) {
    threat++;
    reasons.push({ kind: "threat", text: "rsc.why.exposed" });
  }
  const threatLevel = clamp(threat, n);

  const weights = Object.entries(t.signals) as [SignalKey, number][];
  const total = weights.reduce((s, [, w]) => s + w, 0) + t.capabilities.length;
  let got = 0;
  for (const [k, w] of weights) {
    const h = ctx.hits.find((x) => x.key === k);
    if (h && h.count > 0) {
      got += w;
      reasons.push({ kind: "vuln", text: `rsc.sig.${k}`, params: { n: h.count } });
    }
  }
  const caps = t.capabilities.map((k) => ctx.capabilities[k] ?? "unknown");
  for (const [i, s] of caps.entries()) {
    if (s === "weak") got += 1;
    else if (s === "partial") got += 0.5;
    if (s === "weak" || s === "partial") reasons.push({ kind: "vuln", text: "rsc.why.capability", params: { cap: t.capabilities[i]!, status: s } });
  }
  const measured = caps.some((s) => s !== "unknown") || ctx.hits.some((h) => h.count > 0);
  const lowConfidence = !measured || caps.filter((s) => s === "unknown").length > caps.length / 2;
  let vulnLevel = measured ? clamp(1 + (got / total) * (n - 1) * 1.6, n) : Math.ceil(n / 2);
  if (ctx.detection && ctx.detection.total > 0 && ctx.detection.blind / ctx.detection.total >= 0.5) {
    vulnLevel = clamp(vulnLevel + 1, n);
    reasons.push({ kind: "vuln", text: "rsc.why.detectionBlind", params: { blind: ctx.detection.blind, total: ctx.detection.total } });
  }
  if (lowConfidence) reasons.push({ kind: "vuln", text: "rsc.why.lowConfidence" });
  return { impact, threatLevel, vulnLevel, likelihood: clamp((threatLevel + vulnLevel) / 2, n), lowConfidence, reasons };
}

/** Návrh vzniká jen z doložených dat: aspoň jeden hlavní signál šablony (váha ≥ 2) nebo slabá zmírňující schopnost. */
/** Kontextové signály (vystavení do internetu) zvyšují úroveň, ale samy návrh nevyvolají – nejsou slabinou. */
export const CONTEXT_SIGNALS: SignalKey[] = ["internet_exposed"];
export function scenarioTriggered(t: ScenarioTemplate, hits: SignalHit[], caps: Partial<Record<CapabilityKey, CapabilityStatus>>): boolean {
  // vedlejší signály (váha 1) scénář jen doplní – samy ho nevyvolají
  return (Object.entries(t.signals) as [SignalKey, number][]).some(([k, w]) => w >= 2 && !CONTEXT_SIGNALS.includes(k) && (hits.find((h) => h.key === k)?.count ?? 0) > 0) || t.capabilities.some((k) => caps[k] === "weak");
}

/** Otisk doložených skutečností – změna otisku po zamítnutí návrh znovu otevře. */
export function scenarioFingerprint(hits: SignalHit[], caps: Partial<Record<CapabilityKey, CapabilityStatus>>, t: ScenarioTemplate): string {
  const s = Object.keys(t.signals)
    .map((k) => `${k}:${hits.find((h) => h.key === k)?.count ?? 0}`)
    .concat(t.capabilities.map((k) => `${k}=${caps[k] ?? "unknown"}`));
  return s.sort().join("|");
}

/** Úroveň schopnosti z pokrytí (podíl 0–1). */
export const coverageStatus = (coverage: number | null): CapabilityStatus => (coverage == null ? "unknown" : coverage >= 0.95 ? "strong" : coverage >= 0.7 ? "partial" : "weak");

/* ---------------- vstupy a DTO ---------------- */

export const CapabilityDeclarationInput = z.object({
  status: z.enum(DECLARED_STATUSES),
  product: z.string().trim().max(200).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  url: z
    .string()
    .trim()
    .max(1000)
    .regex(/^https?:\/\//i, "Odkaz musí začínat http:// nebo https://")
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  validUntil: z.string().date().nullable().optional(),
});
export type CapabilityDeclarationInput = z.input<typeof CapabilityDeclarationInput>;

export interface CapabilityMetric {
  key: string;
  value: number;
  total?: number | null;
}
export interface CapabilityDto {
  key: CapabilityKey;
  status: CapabilityStatus;
  confidence: CapabilityConfidence;
  measuredStatus: CapabilityStatus;
  coverage: number | null;
  metrics: CapabilityMetric[];
  /** Kde data ověřit v CONTIXu. */
  links: { label: string; path: string }[];
  declaration: { status: CapabilityStatus; product: string | null; note: string | null; url: string | null; validUntil: string | null; byName: string | null; at: string; expired: boolean } | null;
  /** Deklarace je silnější než změřený stav. */
  conflict: boolean;
  requirements: { ids: string[]; decree409: string[]; decree410: string[] };
}

export const SCENARIO_STATUSES = ["proposed", "accepted", "linked", "rejected", "obsolete"] as const;
export type ScenarioStatus = (typeof SCENARIO_STATUSES)[number];

export interface ScenarioProposalDto {
  id: string;
  companyId: string;
  templateKey: string;
  primaryAssetId: string;
  primaryAssetName: string;
  status: ScenarioStatus;
  levels: number;
  impact: number;
  threatLevel: number;
  vulnLevel: number;
  likelihood: number;
  lowConfidence: boolean;
  hits: SignalHit[];
  capabilities: { key: CapabilityKey; status: CapabilityStatus }[];
  alerts: number;
  reasons: ScenarioEvaluation["reasons"];
  /** Stávající opatření společnosti namapovaná na požadavky zmírňujících schopností. */
  controls: { id: string; code: string | null; name: string; status: string; effectiveness: string }[];
  supportingAssets: { id: string; name: string }[];
  riskId: string | null;
  riskName: string | null;
  reason: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  /** Data se od rozhodnutí změnila. */
  changedSinceDecision: boolean;
  generatedAt: string;
}

export const ScenarioAcceptInput = z.object({
  name: z.string().trim().min(1).max(500).optional(),
  impact: z.number().int().min(1).max(5).optional(),
  threatLevel: z.number().int().min(1).max(5).optional(),
  vulnLevel: z.number().int().min(1).max(5).optional(),
  ownerPositionId: z.string().uuid().nullable().optional(),
});
export const ScenarioDecisionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(3).max(2000) }),
  z.object({ action: z.literal("link"), riskId: z.string().uuid(), reason: z.string().trim().max(2000).optional() }),
  z.object({ action: z.literal("reopen") }),
]);

export const RISK_SCENARIO_LABELS = {
  capability: {
    edr: "Ochrana koncových bodů (EDR / antimalware)",
    mfa: "Vícefaktorové ověření (MFA)",
    privileged_access: "Řízení privilegovaných přístupů",
    segmentation: "Segmentace sítě",
    vuln_mgmt: "Správa zranitelností",
    hardening: "Bezpečná konfigurace (hardening)",
    backup_recovery: "Zálohování a obnova",
    supplier_assurance: "Bezpečnost dodavatelů",
  } satisfies Record<CapabilityKey, string>,
  status: { strong: "Silná", partial: "Částečná", weak: "Slabá", unknown: "Neznámá" } satisfies Record<CapabilityStatus, string>,
  confidence: { measured: "Změřeno z dat", declared: "Deklarováno", none: "Bez dat" } satisfies Record<CapabilityConfidence, string>,
  template: {
    ransomware: "Ransomware zašifruje systémy a znemožní provoz",
    privileged_takeover: "Převzetí privilegovaného účtu",
    known_vuln_exploit: "Zneužití známé zranitelnosti",
    phishing_credentials: "Phishing a krádež přihlašovacích údajů",
    lateral_movement: "Pohyb útočníka sítí ke kritickým systémům",
    backup_failure: "Selhání zálohy nebo obnovy",
    supplier_outage: "Selhání nebo kompromitace kritického dodavatele",
    data_leak_access: "Únik dat přes nadměrná oprávnění",
    insider_misuse: "Zneužití oprávnění nebo sabotáž zevnitř",
    ddos_outage: "Zahlcení nebo výpadek služby dostupné z internetu",
    cloud_misconfig: "Chybná konfigurace cloudu a Microsoft 365",
    software_supply_chain: "Kompromitace přes softwarovou komponentu nebo dodavatele softwaru",
    ot_compromise: "Napadení průmyslových a OT systémů",
    device_loss: "Ztráta nebo krádež notebooku či mobilu",
  } satisfies Record<string, string>,
  signal: {
    no_edr: "Koncová zařízení bez aktivního EDR / agenta",
    kev_exposed: "Aktivně zneužívaná zranitelnost (KEV) na aktivu dostupném z internetu",
    critical_exposed: "Kritická nebo vysoká zranitelnost na aktivu dostupném z internetu",
    vuln_overdue: "Zranitelnosti po termínu opravy",
    eol_os: "Operační systém bez podpory výrobce",
    sca_low: "Nízké skóre bezpečné konfigurace (SCA)",
    internet_exposed: "Aktivum dostupné z internetu",
    mfa_gap: "Uživatelské účty bez MFA",
    priv_no_mfa: "Privilegované účty bez MFA",
    priv_hygiene: "Nálezy u privilegovaných a neaktivních účtů",
    kerberos_weak: "Slabé nastavení Kerberos a účtů (kerberoasting, delegace)",
    unmanaged_devices: "Neevidovaná zařízení v síti",
    restore_untested: "Kritické procesy bez úspěšně otestované obnovy",
    supplier_no_assurance: "Významní dodavatelé bez platné zprávy o ujištění",
    capability_weak: "Slabá bezpečnostní schopnost",
    no_redundancy: "Důležitá podpůrná aktiva bez redundance",
    secure_score_low: "Microsoft Secure Score pod prahem",
    component_vuln: "Kritické / vysoké zranitelnosti v aplikacích a komponentách",
    ot_vulnerable: "Zranitelné nebo vystavené OT / IoT zařízení",
  } satisfies Record<SignalKey, string>,
  scenarioStatus: { proposed: "Návrh", accepted: "Přijato jako riziko", linked: "Navázáno na riziko", rejected: "Zamítnuto", obsolete: "Neaktuální" } satisfies Record<ScenarioStatus, string>,
  coverage: { risk: "Pokryto rizikem", proposed: "Návrh scénáře z dat", not_relevant: "Nerelevantní (zdůvodněno)", unassessed: "Neposouzeno" } satisfies Record<ThreatCoverageState, string>,
} as const;

/* ============================================================
 * Pokrytí katalogu hrozeb (v1.18, ADR-115): primární aktivum × aktivní hrozba z katalogu.
 * Hrozba je u aktiva posouzena, když ji řeší riziko (hlavní nebo další hrozba rizika na aktivu
 * nebo jeho podpůrném aktivu), otevřený návrh scénáře z dat, nebo zdůvodněné „nerelevantní“.
 * ============================================================ */

export const THREAT_COVERAGE_STATES = ["risk", "proposed", "not_relevant", "unassessed"] as const;
export type ThreatCoverageState = (typeof THREAT_COVERAGE_STATES)[number];

export interface ThreatCoverageCell {
  state: ThreatCoverageState;
  risks: { id: string; name: string }[];
  proposalIds: string[];
  reason: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
}

export interface ThreatCoverageDto {
  threats: { id: string; code: string | null; name: string; category: string | null }[];
  assets: { id: string; name: string; criticality: string; cells: Record<string, ThreatCoverageCell>; assessed: number }[];
  summary: Record<ThreatCoverageState, number> & { total: number; assessedShare: number | null };
}

/** Stav buňky: riziko má přednost před návrhem, návrh před zdůvodněním „nerelevantní“. */
export function threatCellState(x: { risks: number; proposals: number; notRelevant: boolean }): ThreatCoverageState {
  return x.risks > 0 ? "risk" : x.proposals > 0 ? "proposed" : x.notRelevant ? "not_relevant" : "unassessed";
}

export function threatCoverageSummary(states: ThreatCoverageState[]): ThreatCoverageDto["summary"] {
  const out = { risk: 0, proposed: 0, not_relevant: 0, unassessed: 0, total: states.length, assessedShare: null as number | null };
  for (const s of states) out[s]++;
  if (states.length) out.assessedShare = (out.total - out.unassessed) / out.total;
  return out;
}

export const ThreatAssessmentInput = z.object({ reason: z.string().trim().min(5).max(2000) });
export type ThreatAssessmentInput = z.input<typeof ThreatAssessmentInput>;

/* ============================================================
 * Analýza rizik z dat ve zprávě o hodnocení rizik (v1.19, ADR-116) – zmrazená část snímku dokumentu.
 * ============================================================ */

export interface RiskDataReport {
  generatedAt: string;
  capabilities: { key: CapabilityKey; status: CapabilityStatus; confidence: CapabilityConfidence; coverage: number | null; product: string | null; note: string | null; validUntil: string | null; conflict: boolean; metrics: CapabilityMetric[] }[];
  coverage: {
    summary: ThreatCoverageDto["summary"];
    threats: number;
    assets: { name: string; criticality: string; risk: number; proposed: number; notRelevant: number; unassessed: number; unassessedCodes: string[] }[];
    notRelevant: { asset: string; threat: string; reason: string; by: string | null; at: string | null }[];
  };
  scenarios: {
    counts: Record<ScenarioStatus, number>;
    decided: { template: string; asset: string; status: ScenarioStatus; risk: string | null; reason: string | null; by: string | null; at: string | null; changed: boolean }[];
  };
  /** Rozhodnutí vlastníků o přehodnocení v období (potvrzení / změna) s podněty. */
  reviews: { risk: string; decision: "confirmed" | "changed"; note: string | null; kinds: string[]; levelBefore: string | null; levelAfter: string | null; by: string | null; at: string }[];
  /** Otevřené podněty k přehodnocení ke dni vytvoření zprávy. */
  pending: { risk: string; kinds: string[]; strong: boolean; due: string | null }[];
  /** Pokrytí technik ATT&CK detekcí (v1.22) – jen když se detekce měří. */
  detection?: { summary: DetectionDto["summary"]; blind: string[] };
}

/* ============================================================
 * Návrhy akcí plánu zvládání z dat (v1.20, ADR-117) – jen návrh, akce vzniknou na pokyn vlastníka rizika.
 * ============================================================ */

export const PLAN_SUGGESTION_KINDS = ["implement_control", "fix_control", "capability"] as const;
export type PlanSuggestionKind = (typeof PLAN_SUGGESTION_KINDS)[number];

export interface PlanSuggestionDto {
  key: string;
  kind: PlanSuggestionKind;
  title: string;
  objective: string;
  controlId: string | null;
  capability: CapabilityKey | null;
  /** Akce se stejným klíčem / opatřením už v plánu je. */
  existing: boolean;
}

export interface PlanSuggestionInput {
  controls: { id: string; code: string | null; name: string; status: string; effectiveness: string; lastTestResult?: string | null; monitorFailing?: boolean }[];
  /** Schopnosti z přijatých / navázaných scénářů rizika (stav z posledního vyhodnocení). */
  capabilities: { key: CapabilityKey; status: CapabilityStatus }[];
  actions: { title: string; controlId: string | null; status: string }[];
}

export function planSuggestions(x: PlanSuggestionInput): PlanSuggestionDto[] {
  const open = x.actions.filter((a) => a.status !== "cancelled" && a.status !== "done");
  const has = (title: string, controlId: string | null) => open.some((a) => (controlId && a.controlId === controlId) || a.title.trim().toLowerCase() === title.trim().toLowerCase());
  const out: PlanSuggestionDto[] = [];
  const nm = (c: { code: string | null; name: string }) => `${c.code ? `${c.code} ` : ""}${c.name}`;
  for (const c of x.controls) {
    if (c.status !== "implemented") {
      const title = `Zavést opatření ${nm(c)}`;
      out.push({ key: `implement:${c.id}`, kind: "implement_control", title, objective: "Opatření je navázáno na riziko, ale není zavedeno – bez něj se zbytkové riziko nesníží.", controlId: c.id, capability: null, existing: has(title, c.id) });
    } else if (c.lastTestResult === "ineffective" || c.monitorFailing || c.effectiveness === "ineffective") {
      const title = `Obnovit účinnost opatření ${nm(c)}`;
      const why = c.lastTestResult === "ineffective" ? "poslední test opatření byl neúčinný" : c.monitorFailing ? "průběžný monitor opatření je nesplněný" : "účinnost opatření je hodnocena jako neúčinná";
      out.push({ key: `fix:${c.id}`, kind: "fix_control", title, objective: `Odstranit příčinu (${why}) a ověřit účinnost novým testem.`, controlId: c.id, capability: null, existing: has(title, c.id) });
    }
  }
  const seen = new Set<CapabilityKey>();
  for (const cap of x.capabilities) {
    if (seen.has(cap.key) || (cap.status !== "weak" && cap.status !== "unknown")) continue;
    seen.add(cap.key);
    const label = RISK_SCENARIO_LABELS.capability[cap.key];
    const title = cap.status === "weak" ? `Posílit schopnost: ${label}` : `Doložit schopnost: ${label}`;
    const objective =
      cap.status === "weak"
        ? `Schopnost je podle dat slabá – doplnit pokrytí, aby scénář přestal být doložený (cíl: silná).`
        : `Ke schopnosti chybí data – napojit zdroj dat v CONTIXu nebo doložit deklarací s důkazem.`;
    out.push({ key: `cap:${cap.key}`, kind: "capability", title, objective, controlId: null, capability: cap.key, existing: has(title, null) });
  }
  return out;
}

export const PlanSuggestionApplyInput = z.object({
  keys: z.array(z.string().max(100)).min(1).max(50),
  ownerPositionId: z.string().uuid().nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
export type PlanSuggestionApplyInput = z.input<typeof PlanSuggestionApplyInput>;


/* ============================================================
 * Pokrytí technik ATT&CK detekcí (v1.22, ADR-119): alerty SOC za 90 dní, plánovaná hledání hrozeb, deklarace pravidel.
 * ============================================================ */

export const DETECTION_STATES = ["detected", "hunted", "declared", "blind"] as const;
export type DetectionState = (typeof DETECTION_STATES)[number];

/** Techniky ze šablon scénářů (rozsah mapy detekce). */
export function scenarioTechniques(): string[] {
  return [...new Set(SCENARIO_TEMPLATES.flatMap((t) => t.attack))].sort();
}

/** Shoda ID techniky včetně podtechnik (T1078 pokrývá T1078.004). */
export const techniqueMatches = (observed: string, technique: string) => observed === technique || observed.startsWith(`${technique}.`);

export function detectionState(x: { alerts: number; hunts: number; declared: boolean }): DetectionState {
  return x.alerts > 0 ? "detected" : x.hunts > 0 ? "hunted" : x.declared ? "declared" : "blind";
}

export interface DetectionDto {
  /** Detekce se měří (SOC má alerty, hledání nebo deklarace); jinak se scénáře neupravují. */
  measured: boolean;
  techniques: {
    id: string;
    name: string | null;
    state: DetectionState;
    alerts: number;
    hunts: { id: string; name: string }[];
    declaration: { source: string; note: string | null; byName: string | null; at: string } | null;
    templates: string[];
  }[];
  summary: Record<DetectionState, number> & { total: number };
}

export function detectionSummary(states: DetectionState[]): DetectionDto["summary"] {
  const out = { detected: 0, hunted: 0, declared: 0, blind: 0, total: states.length };
  for (const s of states) out[s]++;
  return out;
}

export const DetectionDeclarationInput = z.object({
  source: z.string().trim().min(3).max(300),
  note: z.string().trim().max(2000).nullable().optional(),
});
export type DetectionDeclarationInput = z.input<typeof DetectionDeclarationInput>;

export const DETECTION_LABELS = {
  state: { detected: "Zachyceno (alerty za 90 dní)", hunted: "Plánované hledání", declared: "Deklarované pravidlo", blind: "Slepé místo" } satisfies Record<DetectionState, string>,
};
