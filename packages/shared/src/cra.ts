import { z } from "zod";
import { patchOf } from "./zutil";
import { CPE_RE, type CraProductFileDto, type CraSupplyCheckItem } from "./craSupply";

/* ============================================================
 * Cyber Resilience Act – nařízení (EU) 2024/2847 (ADR-092).
 * Produkty s digitálními prvky organizace (výrobce / dovozce / distributor / správce open source),
 * kategorie (výchozí, důležité třídy I a II – příloha III, kritické – příloha IV; technický popis
 * prováděcím nařízením (EU) 2025/2392), postup posuzování shody (čl. 32), základní požadavky přílohy I
 * a povinnosti podle role, podpůrné období, SBOM a hlášení čl. 14 (24 h / 72 h / 14 dní / 1 měsíc).
 * Stav požadavků a časové údaje hlášení se persistují; lhůty, mezery a texty hlášení se počítají při čtení.
 * ============================================================ */

export const CRA_DATES = { reporting: "2026-09-11", notifiedBodies: "2026-06-11", full: "2027-12-11" } as const;

export const CRA_ROLES = ["manufacturer", "importer", "distributor", "oss_steward"] as const;
export type CraRole = (typeof CRA_ROLES)[number];
export const CRA_PRODUCT_TYPES = ["software", "hardware", "both"] as const;
export type CraProductType = (typeof CRA_PRODUCT_TYPES)[number];
export const CRA_STATUSES = ["development", "on_market", "withdrawn"] as const;
export type CraStatus = (typeof CRA_STATUSES)[number];
export const CRA_CATEGORIES = ["default", "important_1", "important_2", "critical"] as const;
export type CraCategory = (typeof CRA_CATEGORIES)[number];
export const CRA_MODULES = ["A", "B_C", "H", "EUCC"] as const;
export type CraModule = (typeof CRA_MODULES)[number];
export const CRA_REQ_STATUSES = ["open", "in_progress", "done", "na"] as const;
export type CraReqStatus = (typeof CRA_REQ_STATUSES)[number];

/** Položky příloh III a IV (zkrácené popisky CONTIXu). */
export const CRA_CATEGORY_ITEMS: { key: string; category: Exclude<CraCategory, "default">; ref: string }[] = [
  { key: "idm_pam", category: "important_1", ref: "příl. III tř. I bod 1" },
  { key: "browser", category: "important_1", ref: "příl. III tř. I bod 2" },
  { key: "password_manager", category: "important_1", ref: "příl. III tř. I bod 3" },
  { key: "antimalware", category: "important_1", ref: "příl. III tř. I bod 4" },
  { key: "vpn", category: "important_1", ref: "příl. III tř. I bod 5" },
  { key: "network_management", category: "important_1", ref: "příl. III tř. I bod 6" },
  { key: "siem", category: "important_1", ref: "příl. III tř. I bod 7" },
  { key: "boot_manager", category: "important_1", ref: "příl. III tř. I bod 8" },
  { key: "pki", category: "important_1", ref: "příl. III tř. I bod 9" },
  { key: "network_interface", category: "important_1", ref: "příl. III tř. I bod 10" },
  { key: "os", category: "important_1", ref: "příl. III tř. I bod 11" },
  { key: "router_switch", category: "important_1", ref: "příl. III tř. I bod 12" },
  { key: "microprocessor", category: "important_1", ref: "příl. III tř. I bod 13" },
  { key: "microcontroller", category: "important_1", ref: "příl. III tř. I bod 14" },
  { key: "asic_fpga", category: "important_1", ref: "příl. III tř. I bod 15" },
  { key: "virtual_assistant", category: "important_1", ref: "příl. III tř. I bod 16" },
  { key: "smart_home_security", category: "important_1", ref: "příl. III tř. I bod 17" },
  { key: "connected_toy", category: "important_1", ref: "příl. III tř. I bod 18" },
  { key: "wearable", category: "important_1", ref: "příl. III tř. I bod 19" },
  { key: "hypervisor", category: "important_2", ref: "příl. III tř. II bod 1" },
  { key: "firewall_ids", category: "important_2", ref: "příl. III tř. II bod 2" },
  { key: "tamper_mpu", category: "important_2", ref: "příl. III tř. II bod 3" },
  { key: "tamper_mcu", category: "important_2", ref: "příl. III tř. II bod 4" },
  { key: "security_box", category: "critical", ref: "příl. IV bod 1" },
  { key: "smart_meter_gateway", category: "critical", ref: "příl. IV bod 2" },
  { key: "smartcard", category: "critical", ref: "příl. IV bod 3" },
];

/** Přípustné postupy posuzování shody (čl. 32). Třída I: modul A jen při plném použití harmonizovaných norem / certifikace. */
export function craConformityOptions(c: CraCategory, oss = false): CraModule[] {
  if (c === "default") return ["A", "B_C", "H", "EUCC"];
  if (c === "important_1") return ["A", "B_C", "H", "EUCC"];
  if (c === "important_2") return oss ? ["A", "B_C", "H", "EUCC"] : ["B_C", "H", "EUCC"];
  return ["EUCC", "B_C", "H"];
}

/* ---------------- požadavky a povinnosti ---------------- */

type Who = "manufacturer" | "importer" | "distributor" | "oss_steward";
export const CRA_REQUIREMENTS: { key: string; group: "part1" | "part2" | "obligation"; ref: string; roles: Who[] }[] = [
  // příloha I část I – základní požadavky na vlastnosti produktu
  { key: "p1_risk_based", group: "part1", ref: "příl. I č. I bod 1", roles: ["manufacturer"] },
  { key: "p1_no_known_vulns", group: "part1", ref: "příl. I č. I bod 2 a)", roles: ["manufacturer"] },
  { key: "p1_secure_default", group: "part1", ref: "příl. I č. I bod 2 b)", roles: ["manufacturer"] },
  { key: "p1_updates", group: "part1", ref: "příl. I č. I bod 2 c)", roles: ["manufacturer"] },
  { key: "p1_access_control", group: "part1", ref: "příl. I č. I bod 2 d)", roles: ["manufacturer"] },
  { key: "p1_confidentiality", group: "part1", ref: "příl. I č. I bod 2 e)", roles: ["manufacturer"] },
  { key: "p1_integrity", group: "part1", ref: "příl. I č. I bod 2 f)", roles: ["manufacturer"] },
  { key: "p1_data_minimisation", group: "part1", ref: "příl. I č. I bod 2 g)", roles: ["manufacturer"] },
  { key: "p1_availability", group: "part1", ref: "příl. I č. I bod 2 h)", roles: ["manufacturer"] },
  { key: "p1_other_devices", group: "part1", ref: "příl. I č. I bod 2 i)", roles: ["manufacturer"] },
  { key: "p1_attack_surface", group: "part1", ref: "příl. I č. I bod 2 j)", roles: ["manufacturer"] },
  { key: "p1_mitigation", group: "part1", ref: "příl. I č. I bod 2 k)", roles: ["manufacturer"] },
  { key: "p1_logging", group: "part1", ref: "příl. I č. I bod 2 l)", roles: ["manufacturer"] },
  { key: "p1_data_removal", group: "part1", ref: "příl. I č. I bod 2 m)", roles: ["manufacturer"] },
  // příloha I část II – zvládání zranitelností
  { key: "p2_sbom", group: "part2", ref: "příl. I č. II bod 1", roles: ["manufacturer"] },
  { key: "p2_remediation", group: "part2", ref: "příl. I č. II bod 2", roles: ["manufacturer"] },
  { key: "p2_testing", group: "part2", ref: "příl. I č. II bod 3", roles: ["manufacturer"] },
  { key: "p2_disclosure", group: "part2", ref: "příl. I č. II bod 4", roles: ["manufacturer"] },
  { key: "p2_cvd_policy", group: "part2", ref: "příl. I č. II bod 5", roles: ["manufacturer", "oss_steward"] },
  { key: "p2_contact", group: "part2", ref: "příl. I č. II bod 6", roles: ["manufacturer", "oss_steward"] },
  { key: "p2_update_distribution", group: "part2", ref: "příl. I č. II bod 7", roles: ["manufacturer"] },
  { key: "p2_free_updates", group: "part2", ref: "příl. I č. II bod 8", roles: ["manufacturer"] },
  // povinnosti hospodářských subjektů
  { key: "o_risk_assessment", group: "obligation", ref: "čl. 13 odst. 2–4", roles: ["manufacturer"] },
  { key: "o_due_diligence", group: "obligation", ref: "čl. 13 odst. 5", roles: ["manufacturer"] },
  { key: "o_component_vulns", group: "obligation", ref: "čl. 13 odst. 6", roles: ["manufacturer"] },
  { key: "o_support_period", group: "obligation", ref: "čl. 13 odst. 8", roles: ["manufacturer"] },
  { key: "o_tech_doc", group: "obligation", ref: "čl. 31, příl. VII", roles: ["manufacturer"] },
  { key: "o_conformity", group: "obligation", ref: "čl. 32", roles: ["manufacturer"] },
  { key: "o_doc", group: "obligation", ref: "čl. 28, příl. V", roles: ["manufacturer"] },
  { key: "o_ce", group: "obligation", ref: "čl. 29, 30", roles: ["manufacturer"] },
  { key: "o_user_info", group: "obligation", ref: "čl. 13 odst. 18, příl. II", roles: ["manufacturer"] },
  { key: "o_retention", group: "obligation", ref: "čl. 13 odst. 13", roles: ["manufacturer"] },
  { key: "o_reporting", group: "obligation", ref: "čl. 14", roles: ["manufacturer", "oss_steward"] },
  { key: "o_oss_policy", group: "obligation", ref: "čl. 24", roles: ["oss_steward"] },
  { key: "i_conformity_check", group: "obligation", ref: "čl. 19 odst. 2", roles: ["importer"] },
  { key: "i_contact", group: "obligation", ref: "čl. 19 odst. 4", roles: ["importer"] },
  { key: "i_vulns", group: "obligation", ref: "čl. 19 odst. 5–6", roles: ["importer"] },
  { key: "i_retention", group: "obligation", ref: "čl. 19 odst. 7", roles: ["importer"] },
  { key: "d_check", group: "obligation", ref: "čl. 20 odst. 2", roles: ["distributor"] },
  { key: "d_vulns", group: "obligation", ref: "čl. 20 odst. 3–4", roles: ["distributor"] },
];
export type CraRequirementKey = (typeof CRA_REQUIREMENTS)[number]["key"];

export interface CraReqState {
  status: CraReqStatus;
  note: string | null;
  at: string | null;
}
export interface CraRequirementItem extends CraReqState {
  key: string;
  group: "part1" | "part2" | "obligation";
  ref: string;
}
export function craRequirementsFor(role: CraRole, states: Record<string, CraReqState | undefined>): CraRequirementItem[] {
  return CRA_REQUIREMENTS.filter((r) => r.roles.includes(role)).map((r) => ({ key: r.key, group: r.group, ref: r.ref, status: states[r.key]?.status ?? "open", note: states[r.key]?.note ?? null, at: states[r.key]?.at ?? null }));
}

/* ---------------- SBOM (CycloneDX / SPDX JSON, zámky závislostí) ---------------- */

export interface SbomComponent {
  name: string;
  version: string | null;
  purl: string | null;
  supplier: string | null;
  license: string | null;
}
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 500) : null);

export const SBOM_FORMATS = ["cyclonedx", "spdx", "bun_lock", "npm_lock", "requirements"] as const;
export type SbomFormat = (typeof SBOM_FORMATS)[number];

/** purl balíčku npm (scope s @ se kóduje jako %40). */
export const npmPurl = (name: string, version: string | null) => `pkg:npm/${name.startsWith("@") ? `%40${name.slice(1)}` : name}${version ? `@${version}` : ""}`;

/**
 * Komponenty ze SBOM (CycloneDX JSON, SPDX JSON) nebo přímo ze zámku závislostí (v1.12, ADR-108): `bun.lock`,
 * `package-lock.json` (v2/v3) a `requirements.txt` (pip). Jen čtení textu, bez síťových dotazů.
 */
export function parseSbom(text: string): { format: SbomFormat; components: SbomComponent[] } {
  const seen = new Set<string>();
  const out: SbomComponent[] = [];
  const add = (c: SbomComponent) => {
    const k = `${c.purl ?? ""}|${c.name}|${c.version ?? ""}`;
    if (!c.name || seen.has(k) || out.length >= 5000) return;
    seen.add(k);
    out.push(c);
  };
  let j: Record<string, unknown> | null = null;
  try {
    j = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // bun.lock je JSON s čárkami na konci – zkusit volnější čtení
    try {
      j = JSON.parse(text.replace(/,(\s*[}\]])/g, "$1")) as Record<string, unknown>;
    } catch {
      j = null;
    }
  }
  if (j && typeof j === "object" && !Array.isArray(j)) {
    if (j.bomFormat === "CycloneDX" || Array.isArray(j.components)) {
      const walk = (list: unknown) => {
        if (!Array.isArray(list)) return;
        for (const raw of list) {
          const c = raw as Record<string, unknown>;
          const lic = Array.isArray(c.licenses)
            ? (c.licenses as Record<string, unknown>[])
                .map((l) => str((l.license as Record<string, unknown> | undefined)?.id) ?? str((l.license as Record<string, unknown> | undefined)?.name) ?? str(l.expression))
                .filter(Boolean)
                .join(" OR ")
            : null;
          add({ name: str(c.name) ?? "", version: str(c.version), purl: str(c.purl), supplier: str((c.supplier as Record<string, unknown> | undefined)?.name) ?? str(c.publisher) ?? str(c.author), license: lic || null });
          walk(c.components);
        }
      };
      walk(j.components);
      return { format: "cyclonedx", components: out };
    }
    if (typeof j.spdxVersion === "string" || Array.isArray(j.packages)) {
      for (const raw of (j.packages as unknown[]) ?? []) {
        const p = raw as Record<string, unknown>;
        const refs = Array.isArray(p.externalRefs) ? (p.externalRefs as Record<string, unknown>[]) : [];
        const purl = str(refs.find((r) => r.referenceType === "purl")?.referenceLocator);
        const lic = str(p.licenseConcluded) ?? str(p.licenseDeclared);
        add({ name: str(p.name) ?? "", version: str(p.versionInfo), purl, supplier: str(p.supplier)?.replace(/^(Organization|Person):\s*/, "") ?? null, license: lic && lic !== "NOASSERTION" ? lic : null });
      }
      return { format: "spdx", components: out };
    }
    const pk = j.packages as Record<string, unknown> | undefined;
    if (j.lockfileVersion !== undefined && pk && typeof pk === "object") {
      const vals = Object.values(pk);
      if (vals.length && vals.every((v) => Array.isArray(v))) {
        // bun.lock: "klíč": ["název@verze", registr, metadata, integrita]
        for (const v of vals as unknown[][]) {
          const id = str(v[0]);
          if (!id) continue;
          const at = id.lastIndexOf("@");
          if (at <= 0) continue;
          const name = id.slice(0, at);
          const version = id.slice(at + 1);
          if (!version || /^(workspace|link|file|git|github|npm):/.test(version) || version.includes("/")) continue;
          add({ name, version, purl: npmPurl(name, version), supplier: null, license: null });
        }
        return { format: "bun_lock", components: out };
      }
      // package-lock.json v2/v3: "node_modules/x": { version, license }
      for (const [key, raw] of Object.entries(pk)) {
        const p = raw as Record<string, unknown>;
        if (!key || p.link === true) continue;
        const name = str(p.name) ?? key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
        const version = str(p.version);
        if (!key.includes("node_modules/") || !version) continue;
        add({ name, version, purl: npmPurl(name, version), supplier: null, license: str(p.license) });
      }
      return { format: "npm_lock", components: out };
    }
    throw new Error("sbom.unknownFormat");
  }
  // requirements.txt (aspoň jeden řádek s verzí, jinak to není seznam závislostí): název==verze (volitelně [extras], ; podmínky, # komentáře); řádky s volbami (-r, -e, --…) se přeskočí
  let pinned = false;
  for (const line of text.split(/\r?\n/)) {
    const l = line.replace(/\s+#.*$/, "").trim();
    if (!l || l.startsWith("#") || l.startsWith("-")) continue;
    const m = l.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*(?:(===?)\s*([^\s;,]+)|[<>~!=]=?[^;]*)?\s*(?:;.*)?$/);
    if (!m) continue;
    const name = m[1]!;
    const version = m[3] ?? null;
    if (/[<>=~!]/.test(l)) pinned = true;
    add({ name, version, purl: `pkg:pypi/${name.toLowerCase().replace(/[-_.]+/g, "-")}${version ? `@${version}` : ""}`, supplier: null, license: null });
  }
  if (out.length && pinned) return { format: "requirements", components: out };
  throw new Error("sbom.unknownFormat");
}

/* ---------------- hlášení čl. 14 ---------------- */

export const CRA_REPORT_KINDS = ["vulnerability", "incident"] as const;
export type CraReportKind = (typeof CRA_REPORT_KINDS)[number];
export const CRA_REPORT_STAGES = ["early", "notification", "final"] as const;
export type CraReportStage = (typeof CRA_REPORT_STAGES)[number];

const addH = (iso: string, h: number) => new Date(new Date(iso).getTime() + h * 3600_000).toISOString();
const addMonth = (iso: string) => {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
};

export interface CraDeadline {
  stage: CraReportStage;
  due: string | null;
  doneAt: string | null;
  state: "done" | "late_done" | "open" | "overdue" | "waiting";
}
/** Lhůty hlášení (čl. 14 odst. 2 a 4): včasné varování 24 h, oznámení 72 h od zjištění; závěrečná zpráva –
 *  zranitelnost do 14 dní od dostupnosti nápravy, incident do 1 měsíce od oznámení. Nepersistovat. */
export function craDeadlines(
  r: { kind: CraReportKind; awareAt: string; earlyWarningAt: string | null; notificationAt: string | null; correctiveAvailableAt: string | null; finalReportAt: string | null },
  now = new Date(),
): CraDeadline[] {
  const st = (due: string | null, done: string | null): CraDeadline["state"] => (done ? (due && done > due ? "late_done" : "done") : !due ? "waiting" : now.toISOString() > due ? "overdue" : "open");
  const early = addH(r.awareAt, 24);
  const notif = addH(r.awareAt, 72);
  const fin = r.kind === "vulnerability" ? (r.correctiveAvailableAt ? addH(r.correctiveAvailableAt, 14 * 24) : null) : r.notificationAt ? addMonth(r.notificationAt) : addMonth(notif);
  return [
    { stage: "early", due: early, doneAt: r.earlyWarningAt, state: st(early, r.earlyWarningAt) },
    { stage: "notification", due: notif, doneAt: r.notificationAt, state: st(notif, r.notificationAt) },
    { stage: "final", due: fin, doneAt: r.finalReportAt, state: st(fin, r.finalReportAt) },
  ];
}

export interface CraReportSection {
  label: string;
  value: string;
}
const RT = {
  cs: {
    product: "Produkt (název, verze)",
    manufacturer: "Výrobce",
    kind: "Druh hlášení",
    kindV: { vulnerability: "Aktivně zneužívaná zranitelnost", incident: "Závažný incident s dopadem na bezpečnost produktu" },
    aware: "Zjištěno",
    malicious: "Podezření na protiprávní nebo škodlivé jednání",
    states: "Členské státy, kde je produkt dodáván",
    cve: "Identifikátory zranitelnosti",
    nature: "Povaha zranitelnosti / incidentu a způsob zneužití",
    severity: "Závažnost a dopad",
    measures: "Přijatá nápravná a zmírňující opatření",
    userMeasures: "Opatření, která mohou přijmout uživatelé",
    sensitivity: "Citlivost poskytnutých informací",
    rootCause: "Druh hrozby / hlavní příčina",
    actor: "Informace o škodlivém aktérovi",
    update: "Bezpečnostní aktualizace / náprava (dostupná od)",
    yes: "ano",
    no: "ne",
    unknown: "zatím neznámo",
  },
  en: {
    product: "Product (name, version)",
    manufacturer: "Manufacturer",
    kind: "Notification type",
    kindV: { vulnerability: "Actively exploited vulnerability", incident: "Severe incident having an impact on the security of the product" },
    aware: "Became aware",
    malicious: "Suspected unlawful or malicious act",
    states: "Member States where the product is made available",
    cve: "Vulnerability identifiers",
    nature: "Nature of the vulnerability / incident and of the exploit",
    severity: "Severity and impact",
    measures: "Corrective or mitigating measures taken",
    userMeasures: "Measures users can take",
    sensitivity: "Sensitivity of the information provided",
    rootCause: "Type of threat / root cause",
    actor: "Information on the malicious actor",
    update: "Security update / corrective measure (available since)",
    yes: "yes",
    no: "no",
    unknown: "not yet known",
  },
};

/** Obsah hlášení pro jednotnou platformu ENISA (SRP) podle fáze – jen text k opsání, nic se neodesílá. */
export function buildCraReport(
  p: { name: string; version: string | null; manufacturer: string },
  r: {
    kind: CraReportKind;
    awareAt: string;
    malicious: boolean | null;
    memberStates: string[];
    cveIds: string[];
    description: string | null;
    severity: string | null;
    mitigation: string | null;
    userMeasures: string | null;
    sensitivity: string | null;
    rootCause: string | null;
    actorInfo: string | null;
    correctiveAvailableAt: string | null;
  },
  stage: CraReportStage,
  locale: "cs" | "en" = "cs",
): CraReportSection[] {
  const x = RT[locale];
  const v = (s: string | null | undefined) => (s?.trim() ? s.trim() : x.unknown);
  const out: CraReportSection[] = [
    { label: x.product, value: `${p.name}${p.version ? ` ${p.version}` : ""}` },
    { label: x.manufacturer, value: p.manufacturer },
    { label: x.kind, value: x.kindV[r.kind] },
    { label: x.aware, value: r.awareAt.slice(0, 16).replace("T", " ") + " UTC" },
  ];
  if (r.cveIds.length) out.push({ label: x.cve, value: r.cveIds.join(", ") });
  out.push({ label: x.malicious, value: r.malicious == null ? x.unknown : r.malicious ? x.yes : x.no });
  out.push({ label: x.states, value: r.memberStates.length ? r.memberStates.join(", ") : x.unknown });
  if (stage === "early") return out;
  out.push({ label: x.nature, value: v(r.description) });
  out.push({ label: x.measures, value: v(r.mitigation) });
  out.push({ label: x.userMeasures, value: v(r.userMeasures) });
  out.push({ label: x.sensitivity, value: v(r.sensitivity) });
  if (stage === "notification") return out;
  out.push({ label: x.severity, value: v(r.severity) });
  if (r.kind === "vulnerability") {
    out.push({ label: x.actor, value: v(r.actorInfo) });
    out.push({ label: x.update, value: r.correctiveAvailableAt ? r.correctiveAvailableAt.slice(0, 10) : x.unknown });
  } else out.push({ label: x.rootCause, value: v(r.rootCause) });
  return out;
}

/* ---------------- mezery produktu ---------------- */

export const CRA_GAPS = ["no_category", "no_support_period", "support_short", "no_contact", "no_conformity", "conformity_not_allowed", "no_sbom", "requirements_open", "reports_overdue", "support_ending", "vulns_open", "vulns_kev", "supply_checks_open", "no_manufacturer_support", "no_vuln_source"] as const;
export type CraGap = (typeof CRA_GAPS)[number];

export function craProductGaps(p: {
  role: CraRole;
  status: CraStatus;
  category: CraCategory | null;
  supportUntil: string | null;
  supportJustification: string | null;
  onMarketSince: string | null;
  securityContact: string | null;
  conformityModule: CraModule | null;
  oss: boolean;
  components: number;
  requirements: CraRequirementItem[];
  overdueReports: number;
  today: string;
  /** Zranitelnosti komponent ve stavu prošetřuje se / zasaženo (ADR-093). */
  openVulns?: number;
  /** Z toho v katalogu KEV (aktivně zneužívané – zvážit hlášení čl. 14). */
  kevVulns?: number;
  /** Dovozce / distributor: neověřené povinné doklady výrobce (v1.16, ADR-113). */
  supplyOpen?: number;
  /** Je odkud brát zranitelnosti: SBOM, CPE nebo oznámení výrobce (CSAF). */
  vulnSource?: boolean;
}): CraGap[] {
  if (p.status === "withdrawn") return p.overdueReports ? ["reports_overdue"] : [];
  const g: CraGap[] = [];
  const mf = p.role === "manufacturer";
  const ending = !!p.supportUntil && p.status === "on_market" && (new Date(p.supportUntil).getTime() - new Date(p.today).getTime()) / 86400_000 < 180;
  if (!p.category) g.push("no_category");
  if (mf) {
    if (!p.supportUntil) g.push("no_support_period");
    else if (p.onMarketSince) {
      const years = (new Date(p.supportUntil).getTime() - new Date(p.onMarketSince).getTime()) / (365.25 * 86400_000);
      if (years < 5 - 1e-6 && !p.supportJustification?.trim()) g.push("support_short");
    }
    if (ending) g.push("support_ending");
    if (!p.conformityModule) g.push("no_conformity");
    else if (p.category && !craConformityOptions(p.category, p.oss).includes(p.conformityModule)) g.push("conformity_not_allowed");
    if (!p.components) g.push("no_sbom");
  }
  if (p.role === "importer" || p.role === "distributor") {
    if (!p.supportUntil) g.push("no_manufacturer_support");
    else if (ending) g.push("support_ending");
    if (p.supplyOpen) g.push("supply_checks_open");
    if (p.vulnSource === false) g.push("no_vuln_source");
  }
  if ((mf || p.role === "oss_steward") && !p.securityContact?.trim()) g.push("no_contact");
  if (p.requirements.some((r) => r.status === "open" || r.status === "in_progress")) g.push("requirements_open");
  if (p.overdueReports) g.push("reports_overdue");
  if (p.openVulns) g.push("vulns_open");
  if (p.kevVulns) g.push("vulns_kev");
  return g;
}

/* ---------------- vstupy a DTO ---------------- */

const text = (max = 5000) => z.string().trim().max(max).nullable().optional();
const date = z.string().date().nullable().optional();

export const CraProductInput = z.object({
  companyId: z.string().uuid().optional(),
  code: z.string().trim().max(50).nullable().optional(),
  name: z.string().trim().min(1).max(300),
  version: text(100),
  productType: z.enum(CRA_PRODUCT_TYPES).default("software"),
  role: z.enum(CRA_ROLES).default("manufacturer"),
  status: z.enum(CRA_STATUSES).default("development"),
  /** Svobodný a otevřený software vyvinutý mimo obchodní činnost – mírnější postup posuzování shody. */
  oss: z.boolean().default(false),
  description: text(),
  intendedPurpose: text(),
  category: z.enum(CRA_CATEGORIES).nullable().optional(),
  categoryItem: z.string().trim().max(40).nullable().optional(),
  onMarketSince: date,
  supportUntil: date,
  supportJustification: text(2000),
  conformityModule: z.enum(CRA_MODULES).nullable().optional(),
  harmonisedStandards: text(2000),
  notifiedBody: text(300),
  ceMarkedAt: date,
  docIssuedAt: date,
  securityContact: text(500),
  cvdPolicyUrl: text(1000),
  /** Výrobce u dovozce / distributora. */
  manufacturerName: text(300),
  /** Identifikátor CPE 2.3 produktu – párování oznámení výrobce a NVD bez SBOM (v1.16). */
  cpe: z.string().trim().max(500).regex(CPE_RE, "CPE 2.3, např. cpe:2.3:h:vyrobce:produkt:1.0").nullable().optional().or(z.literal("").transform(() => null)),
  memberStates: z.array(z.string().trim().length(2).toUpperCase()).max(40).default([]),
  ownerPositionId: z.string().uuid().nullable().optional(),
});
export type CraProductInput = z.input<typeof CraProductInput>;
export const CraProductPatch = patchOf(CraProductInput.omit({ companyId: true }));
export const CraRequirementInput = z.object({ status: z.enum(CRA_REQ_STATUSES), note: z.string().trim().max(3000).nullable().optional() });
export const CraComponentInput = z.object({
  name: z.string().trim().min(1).max(300),
  version: text(100),
  purl: text(500),
  supplier: text(300),
  license: text(200),
});
const ts = z.string().datetime({ offset: true }).nullable().optional();
export const CraReportInput = z.object({
  kind: z.enum(CRA_REPORT_KINDS),
  title: z.string().trim().min(1).max(300),
  awareAt: z.string().datetime({ offset: true }),
  cveIds: z.array(z.string().trim().regex(/^(CVE-\d{4}-\d{4,}|EUVD-\d{4}-\d{3,}|GHSA-[\w-]+)$/i)).max(50).default([]),
  malicious: z.boolean().nullable().optional(),
  memberStates: z.array(z.string().trim().length(2).toUpperCase()).max(40).default([]),
  description: text(10000),
  severity: text(2000),
  mitigation: text(10000),
  userMeasures: text(5000),
  sensitivity: text(1000),
  rootCause: text(5000),
  actorInfo: text(3000),
  srpRef: text(100),
  earlyWarningAt: ts,
  notificationAt: ts,
  correctiveAvailableAt: ts,
  finalReportAt: ts,
  usersInformedAt: ts,
  closed: z.boolean().optional(),
});
export type CraReportInput = z.input<typeof CraReportInput>;
export const CraReportPatch = patchOf(CraReportInput);

export interface CraComponentDto extends SbomComponent {
  id: string;
}
export interface CraReportDto {
  id: string;
  productId: string;
  productName: string;
  companyId: string;
  kind: CraReportKind;
  title: string;
  awareAt: string;
  cveIds: string[];
  malicious: boolean | null;
  memberStates: string[];
  description: string | null;
  severity: string | null;
  mitigation: string | null;
  userMeasures: string | null;
  sensitivity: string | null;
  rootCause: string | null;
  actorInfo: string | null;
  srpRef: string | null;
  earlyWarningAt: string | null;
  notificationAt: string | null;
  correctiveAvailableAt: string | null;
  finalReportAt: string | null;
  usersInformedAt: string | null;
  closed: boolean;
  deadlines: CraDeadline[];
  updatedAt: string;
}
export interface CraProductDto {
  id: string;
  companyId: string;
  code: string | null;
  name: string;
  version: string | null;
  productType: CraProductType;
  role: CraRole;
  status: CraStatus;
  oss: boolean;
  description: string | null;
  intendedPurpose: string | null;
  category: CraCategory | null;
  categoryItem: string | null;
  onMarketSince: string | null;
  supportUntil: string | null;
  supportJustification: string | null;
  conformityModule: CraModule | null;
  conformityOptions: CraModule[];
  harmonisedStandards: string | null;
  notifiedBody: string | null;
  ceMarkedAt: string | null;
  docIssuedAt: string | null;
  securityContact: string | null;
  cvdPolicyUrl: string | null;
  manufacturerName: string | null;
  cpe: string | null;
  memberStates: string[];
  ownerPositionId: string | null;
  ownerPositionName: string | null;
  requirements: CraRequirementItem[];
  componentCount: number;
  openReports: number;
  overdueReports: number;
  openVulns: number;
  kevVulns: number;
  gaps: CraGap[];
  /** Dovozce / distributor: kontrola dokladů výrobce (v1.16). */
  supplyChecks: CraSupplyCheckItem[];
  /** Soubory produktu bez vazby na doklad. */
  files: CraProductFileDto[];
  /** Oznámení výrobce (CSAF), která se produktu týkají. */
  advisoryCount: number;
  canEdit: boolean;
  updatedAt: string;
}

/* ---------------- popisky ---------------- */

export const CRA_LABELS = {
  role: { manufacturer: "Výrobce", importer: "Dovozce", distributor: "Distributor", oss_steward: "Správce softwaru s otevřeným zdrojovým kódem" } satisfies Record<CraRole, string>,
  productType: { software: "Software", hardware: "Hardware", both: "Hardware se softwarem" } satisfies Record<CraProductType, string>,
  status: { development: "Ve vývoji", on_market: "Na trhu", withdrawn: "Stažen z trhu" } satisfies Record<CraStatus, string>,
  category: { default: "Výchozí kategorie", important_1: "Důležitý produkt – třída I", important_2: "Důležitý produkt – třída II", critical: "Kritický produkt" } satisfies Record<CraCategory, string>,
  module: { A: "Modul A – interní kontrola", B_C: "Moduly B + C – EU přezkoušení typu a shoda s typem", H: "Modul H – plné zabezpečování kvality", EUCC: "Evropský certifikát kybernetické bezpečnosti (EUCC)" } satisfies Record<CraModule, string>,
  reqStatus: { open: "Nesplněno", in_progress: "Rozpracováno", done: "Splněno", na: "Netýká se" } satisfies Record<CraReqStatus, string>,
  group: { part1: "Příloha I část I – bezpečnostní vlastnosti produktu", part2: "Příloha I část II – zvládání zranitelností", obligation: "Povinnosti hospodářského subjektu" },
  reportKind: { vulnerability: "Aktivně zneužívaná zranitelnost", incident: "Závažný incident" } satisfies Record<CraReportKind, string>,
  stage: { early: "Včasné varování (24 h)", notification: "Oznámení (72 h)", final: "Závěrečná zpráva" } satisfies Record<CraReportStage, string>,
  item: {
    idm_pam: "Správa identit a privilegovaných přístupů, čtečky pro autentizaci a řízení přístupu",
    browser: "Samostatné a vestavěné prohlížeče",
    password_manager: "Správci hesel",
    antimalware: "Software pro vyhledávání a odstraňování škodlivého kódu",
    vpn: "Produkty VPN",
    network_management: "Systémy správy sítě",
    siem: "Systémy SIEM",
    boot_manager: "Zavaděče (boot manager)",
    pki: "Infrastruktura veřejných klíčů a vydávání certifikátů",
    network_interface: "Fyzická a virtuální síťová rozhraní",
    os: "Operační systémy",
    router_switch: "Routery, modemy pro připojení k internetu a přepínače",
    microprocessor: "Mikroprocesory s bezpečnostními funkcemi",
    microcontroller: "Mikrokontroléry s bezpečnostními funkcemi",
    asic_fpga: "ASIC a FPGA s bezpečnostními funkcemi",
    virtual_assistant: "Univerzální virtuální asistenti chytré domácnosti",
    smart_home_security: "Produkty chytré domácnosti s bezpečnostní funkcí (zámky, kamery, alarmy, chůvičky)",
    connected_toy: "Hračky připojené k internetu s interakcí nebo sledováním polohy",
    wearable: "Nositelná zařízení pro sledování zdraví nebo určená dětem",
    hypervisor: "Hypervisory a běhová prostředí kontejnerů",
    firewall_ids: "Firewally, systémy detekce a prevence průniku",
    tamper_mpu: "Mikroprocesory odolné proti neoprávněné manipulaci",
    tamper_mcu: "Mikrokontroléry odolné proti neoprávněné manipulaci",
    security_box: "Hardwarová zařízení s bezpečnostními schránkami",
    smart_meter_gateway: "Brány inteligentních měřicích systémů a zařízení pro bezpečné kryptografické zpracování",
    smartcard: "Čipové karty a bezpečné prvky",
  } as Record<string, string>,
  req: {
    p1_risk_based: "Návrh, vývoj a výroba zajišťují úroveň kybernetické bezpečnosti přiměřenou rizikům",
    p1_no_known_vulns: "Při dodání na trh bez známých zneužitelných zranitelností",
    p1_secure_default: "Bezpečná výchozí konfigurace a možnost obnovit původní stav",
    p1_updates: "Řešení zranitelností bezpečnostními aktualizacemi (výchozí automatické s možností odmítnutí)",
    p1_access_control: "Ochrana před neoprávněným přístupem – autentizace, správa identit a přístupů",
    p1_confidentiality: "Důvěrnost uložených, přenášených a zpracovávaných dat (šifrování)",
    p1_integrity: "Integrita dat, programů a konfigurace, hlášení poškození",
    p1_data_minimisation: "Zpracování jen nezbytných dat (minimalizace)",
    p1_availability: "Dostupnost základních funkcí i během incidentu, odolnost proti DoS",
    p1_other_devices: "Minimalizace dopadu na dostupnost jiných zařízení a sítí",
    p1_attack_surface: "Omezení plochy útoku včetně externích rozhraní",
    p1_mitigation: "Mechanismy a techniky omezující dopad incidentu",
    p1_logging: "Záznam a monitorování relevantních interních činností (s možností vypnutí uživatelem)",
    p1_data_removal: "Bezpečné odstranění dat a nastavení uživatelem a jejich přenos",
    p2_sbom: "Identifikace a dokumentace zranitelností a komponent – SBOM ve strojově čitelném formátu",
    p2_remediation: "Neprodlené řešení zranitelností, bezpečnostní aktualizace odděleně od funkčních",
    p2_testing: "Pravidelné testy a přezkumy bezpečnosti produktu",
    p2_disclosure: "Zveřejnění informací o opravených zranitelnostech po vydání aktualizace",
    p2_cvd_policy: "Politika koordinovaného zveřejňování zranitelností",
    p2_contact: "Kontaktní adresa pro hlášení zranitelností a sdílení informací",
    p2_update_distribution: "Mechanismy bezpečné distribuce aktualizací",
    p2_free_updates: "Bezpečnostní aktualizace neprodleně a bezplatně, s doporučeními pro uživatele",
    o_risk_assessment: "Posouzení kybernetických rizik produktu – zdokumentované a aktualizované",
    o_due_diligence: "Náležitá péče u komponent třetích stran včetně open source",
    o_component_vulns: "Hlášení zranitelností nalezených v komponentách jejich správcům",
    o_support_period: "Podpůrné období (zpravidla alespoň 5 let) a jeho uvedení při nákupu",
    o_tech_doc: "Technická dokumentace podle přílohy VII",
    o_conformity: "Postup posuzování shody podle kategorie produktu",
    o_doc: "EU prohlášení o shodě",
    o_ce: "Označení CE",
    o_user_info: "Informace a pokyny pro uživatele podle přílohy II",
    o_retention: "Uchování technické dokumentace a prohlášení 10 let nebo po dobu podpory",
    o_reporting: "Hlášení aktivně zneužívaných zranitelností a závažných incidentů (od 11. 9. 2026)",
    o_oss_policy: "Politika kybernetické bezpečnosti správce a spolupráce s orgány dozoru",
    i_conformity_check: "Ověření posouzení shody, technické dokumentace, CE, prohlášení a pokynů výrobce",
    i_contact: "Uvedení jména a kontaktu dovozce na produktu nebo v dokumentaci",
    i_vulns: "Informování výrobce o zranitelnostech a orgánů dozoru o významném riziku",
    i_retention: "Uchování EU prohlášení o shodě a dokumentace pro orgány dozoru",
    d_check: "Ověření označení CE, prohlášení a pokynů výrobce a dovozce",
    d_vulns: "Informování výrobce o zranitelnostech a nedodávání neshodného produktu",
  } satisfies Record<CraRequirementKey, string>,
  gap: {
    no_category: "Chybí zařazení do kategorie (výchozí / důležitý / kritický)",
    no_support_period: "Chybí konec podpůrného období",
    support_short: "Podpůrné období kratší než 5 let bez zdůvodnění",
    no_contact: "Chybí kontakt pro hlášení zranitelností",
    no_conformity: "Chybí postup posuzování shody",
    conformity_not_allowed: "Zvolený postup posuzování shody není pro kategorii přípustný",
    no_sbom: "Chybí SBOM (komponenty)",
    requirements_open: "Nesplněné požadavky",
    reports_overdue: "Hlášení čl. 14 po lhůtě",
    support_ending: "Podpůrné období končí do 6 měsíců",
    vulns_open: "Neuzavřené zranitelnosti komponent (VEX)",
    vulns_kev: "Komponenta se zranitelností z katalogu KEV – zvažte hlášení čl. 14",
    supply_checks_open: "Neověřené doklady výrobce (CE, prohlášení o shodě, informace přílohy II)",
    no_manufacturer_support: "Chybí datum konce podpory výrobce",
    no_vuln_source: "Chybí zdroj informací o zranitelnostech (CPE nebo oznámení výrobce CSAF)",
  } satisfies Record<CraGap, string>,
} as const;
