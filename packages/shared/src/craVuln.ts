import { z } from "zod";

/* ============================================================
 * Zranitelnosti komponent produktů (CRA, ADR-093): offline databáze OSV (stažení po ekosystémech nebo nahrání ZIP),
 * párování komponent SBOM podle purl a verze, prohlášení VEX a export OpenVEX / CycloneDX VEX.
 * Párování je jen lokální – nic se neodesílá. Porovnání verzí je obecné (ne plná sémantika každého ekosystému),
 * shoda podle výčtu verzí v záznamu OSV má přednost před rozsahy.
 * ============================================================ */

/** Ekosystémy OSV (název = adresář v bucketu OSV). */
export const OSV_ECOSYSTEMS = ["npm", "PyPI", "Maven", "Go", "crates.io", "NuGet", "RubyGems", "Packagist", "Hex", "Pub", "Debian", "Ubuntu", "Alpine"] as const;
export type OsvEcosystem = (typeof OSV_ECOSYSTEMS)[number];
export const OSV_DEFAULT_BASE = "https://osv-vulnerabilities.storage.googleapis.com";

const PURL_ECO: Record<string, OsvEcosystem> = {
  npm: "npm",
  pypi: "PyPI",
  maven: "Maven",
  golang: "Go",
  cargo: "crates.io",
  nuget: "NuGet",
  gem: "RubyGems",
  composer: "Packagist",
  hex: "Hex",
  pub: "Pub",
  apk: "Alpine",
};

/** purl → ekosystém OSV, název balíčku a verze (null = typ, který OSV nepokrývá, např. pkg:generic). */
export function purlToOsv(purl: string | null | undefined, fallbackVersion?: string | null): { ecosystem: OsvEcosystem; name: string; version: string | null } | null {
  if (!purl) return null;
  const m = purl.trim().match(/^pkg:([a-z0-9.+-]+)\/(.+?)(?:@([^?#]+))?(?:\?[^#]*)?(?:#.*)?$/i);
  if (!m) return null;
  const type = m[1]!.toLowerCase();
  const path = m[2]!.split("/").map((x) => decodeURIComponent(x));
  const version = m[3] ? decodeURIComponent(m[3]) : (fallbackVersion ?? null);
  if (type === "deb") {
    const ns = path.length > 1 ? path[0]!.toLowerCase() : "debian";
    return { ecosystem: ns === "ubuntu" ? "Ubuntu" : "Debian", name: path[path.length - 1]!, version };
  }
  const eco = PURL_ECO[type];
  if (!eco) return null;
  if (eco === "Maven") return path.length >= 2 ? { ecosystem: eco, name: `${path[0]}:${path[1]}`, version } : null;
  if (eco === "npm" || eco === "Go" || eco === "Packagist") return { ecosystem: eco, name: path.join("/"), version };
  const name = path[path.length - 1]!;
  return { ecosystem: eco, name: eco === "PyPI" ? name.toLowerCase().replace(/[-_.]+/g, "-") : name, version };
}

/* ---------------- záznam OSV ---------------- */

export interface OsvAffected {
  ecosystem: string;
  name: string;
  versions: string[];
  ranges: { type: string; events: Record<string, string>[] }[];
}
export interface OsvRecord {
  id: string;
  aliases: string[];
  summary: string | null;
  severity: string | null;
  modified: string | null;
  withdrawn: boolean;
  affected: OsvAffected[];
}

/** Záznam OSV (schema 1.x) → kompaktní podoba pro uložení. Ekosystém bez přípony verze („Debian:12“ → „Debian“). */
export function parseOsvRecord(text: string): OsvRecord | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof j.id !== "string" || !Array.isArray(j.affected)) return null;
  const sev = Array.isArray(j.severity) ? ((j.severity as Record<string, unknown>[]).find((s) => typeof s.score === "string")?.score as string | undefined) : undefined;
  const dbSev = (j.database_specific as Record<string, unknown> | undefined)?.severity;
  const affected: OsvAffected[] = [];
  for (const raw of j.affected as Record<string, unknown>[]) {
    const pkg = raw.package as Record<string, unknown> | undefined;
    if (!pkg || typeof pkg.name !== "string" || typeof pkg.ecosystem !== "string") continue;
    affected.push({
      ecosystem: pkg.ecosystem.split(":")[0]!,
      name: pkg.name,
      versions: Array.isArray(raw.versions) ? (raw.versions as unknown[]).filter((v): v is string => typeof v === "string").slice(0, 5000) : [],
      ranges: Array.isArray(raw.ranges)
        ? (raw.ranges as Record<string, unknown>[])
            .filter((r) => r.type === "SEMVER" || r.type === "ECOSYSTEM")
            .map((r) => ({ type: String(r.type), events: Array.isArray(r.events) ? (r.events as Record<string, string>[]) : [] }))
        : [],
    });
  }
  if (!affected.length) return null;
  const aliases = [...new Set([...(Array.isArray(j.aliases) ? (j.aliases as string[]) : []), ...(Array.isArray(j.upstream) ? (j.upstream as string[]) : [])].filter((a) => typeof a === "string"))].slice(0, 50);
  return {
    id: j.id.slice(0, 100),
    aliases,
    summary: typeof j.summary === "string" ? j.summary.slice(0, 1000) : typeof j.details === "string" ? j.details.slice(0, 300) : null,
    severity: sev ? sev.slice(0, 200) : typeof dbSev === "string" ? dbSev.slice(0, 50) : null,
    modified: typeof j.modified === "string" ? j.modified : null,
    withdrawn: typeof j.withdrawn === "string",
    affected,
  };
}

/** Obecné porovnání verzí: epocha (Debian „1:“), čísla číselně, text lexikálně, „~“ (pre-release) před vším. */
export function compareVersions(a: string, b: string): number {
  const epoch = (v: string) => {
    const m = v.match(/^(\d+):(.*)$/);
    return m ? [Number(m[1]), m[2]!] as const : ([0, v] as const);
  };
  const [ea, ra] = epoch(a.replace(/^v/i, ""));
  const [eb, rb] = epoch(b.replace(/^v/i, ""));
  if (ea !== eb) return ea - eb;
  const tok = (v: string) => v.match(/~|\d+|[A-Za-z]+/g) ?? [];
  const ta = tok(ra);
  const tb = tok(rb);
  for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
    const x = ta[i];
    const y = tb[i];
    if (x === y) continue;
    if (x === "~") return -1;
    if (y === "~") return 1;
    if (x === undefined) return /^[A-Za-z]/.test(y!) ? 1 : -1; // 1.0 > 1.0rc1, 1.0 < 1.0.1
    if (y === undefined) return /^[A-Za-z]/.test(x) ? -1 : 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d) return d;
      continue;
    }
    if (nx !== ny) return nx ? 1 : -1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** Je verze zasažena záznamem OSV (výčet verzí, rozsahy introduced / fixed / last_affected / limit)? */
export function osvAffects(a: OsvAffected, version: string | null): boolean {
  if (!version) return false;
  if (a.versions.includes(version)) return true;
  for (const r of a.ranges) {
    let introduced: string | null = null;
    for (const ev of r.events) {
      if (ev.introduced !== undefined) introduced = ev.introduced;
      else if (introduced !== null && (ev.fixed !== undefined || ev.last_affected !== undefined || ev.limit !== undefined)) {
        const lower = introduced === "0" || compareVersions(version, introduced) >= 0;
        const upper = ev.fixed !== undefined ? compareVersions(version, ev.fixed) < 0 : ev.last_affected !== undefined ? compareVersions(version, ev.last_affected) <= 0 : compareVersions(version, ev.limit!) < 0;
        if (lower && upper) return true;
        introduced = null;
      }
    }
    if (introduced !== null && (introduced === "0" || compareVersions(version, introduced) >= 0)) return true;
  }
  return false;
}

/** CVE z ID a aliasů (pro KEV / EPSS). */
export const cvesOf = (id: string, aliases: string[]) => [...new Set([id, ...aliases].filter((x) => /^CVE-\d{4}-\d{4,}$/i.test(x)).map((x) => x.toUpperCase()))];

/* ---------------- VEX ---------------- */

export const VEX_STATUSES = ["under_investigation", "affected", "not_affected", "fixed"] as const;
export type VexStatus = (typeof VEX_STATUSES)[number];
export const VEX_JUSTIFICATIONS = ["component_not_present", "vulnerable_code_not_present", "vulnerable_code_not_in_execute_path", "vulnerable_code_cannot_be_controlled_by_adversary", "inline_mitigations_already_exist"] as const;
export type VexJustification = (typeof VEX_JUSTIFICATIONS)[number];

const CDX_STATE: Record<VexStatus, string> = { under_investigation: "in_triage", affected: "exploitable", not_affected: "not_affected", fixed: "resolved" };
const CDX_JUST: Record<VexJustification, string> = {
  component_not_present: "code_not_present",
  vulnerable_code_not_present: "code_not_present",
  vulnerable_code_not_in_execute_path: "code_not_reachable",
  vulnerable_code_cannot_be_controlled_by_adversary: "protected_at_runtime",
  inline_mitigations_already_exist: "protected_by_mitigating_control",
};

export interface VexStatement {
  vulnId: string;
  aliases: string[];
  componentRef: string;
  status: VexStatus;
  justification: VexJustification | null;
  impactStatement: string | null;
  actionStatement: string | null;
}

/** OpenVEX 0.2.0. */
export function buildOpenVex(p: { name: string; version: string | null; id: string }, author: string, statements: VexStatement[], now = new Date()) {
  const productId = `urn:contix:product:${p.id}`;
  return {
    "@context": "https://openvex.dev/ns/v0.2.0",
    "@id": `urn:contix:vex:${p.id}:${now.getTime()}`,
    author,
    timestamp: now.toISOString(),
    version: 1,
    tooling: "CONTIX",
    statements: statements.map((s) => ({
      vulnerability: { name: s.vulnId, ...(s.aliases.length ? { aliases: s.aliases } : {}) },
      products: [{ "@id": productId, subcomponents: [{ "@id": s.componentRef }] }],
      status: s.status,
      ...(s.status === "not_affected" ? { justification: s.justification ?? "vulnerable_code_not_present", ...(s.impactStatement ? { impact_statement: s.impactStatement } : {}) } : {}),
      ...(s.status === "affected" ? { action_statement: s.actionStatement ?? "Remediation under preparation." } : {}),
      ...(s.status !== "not_affected" && s.impactStatement ? { status_notes: s.impactStatement } : {}),
    })),
  };
}

/** CycloneDX 1.5 VEX (vulnerabilities s analýzou, odkazy na komponenty bom-ref = purl / název@verze). */
export function buildCycloneDxVex(p: { name: string; version: string | null; id: string }, author: string, statements: VexStatement[], now = new Date()) {
  const refs = [...new Set(statements.map((s) => s.componentRef))];
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: { timestamp: now.toISOString(), authors: [{ name: author }], component: { type: "application", "bom-ref": `urn:contix:product:${p.id}`, name: p.name, ...(p.version ? { version: p.version } : {}) } },
    components: refs.map((r) => ({ type: "library", "bom-ref": r, name: r.startsWith("pkg:") ? r : r.split("@")[0], ...(r.startsWith("pkg:") ? { purl: r } : {}) })),
    vulnerabilities: statements.map((s) => ({
      id: s.vulnId,
      ...(s.aliases.length ? { references: s.aliases.map((a) => ({ id: a, source: { name: a.startsWith("CVE-") ? "NVD" : "OSV" } })) } : {}),
      affects: [{ ref: s.componentRef }],
      analysis: {
        state: CDX_STATE[s.status],
        ...(s.status === "not_affected" && s.justification ? { justification: CDX_JUST[s.justification] } : {}),
        ...(s.impactStatement || s.actionStatement ? { detail: [s.impactStatement, s.actionStatement].filter(Boolean).join(" ") } : {}),
        ...(s.status === "affected" ? { response: ["update"] } : {}),
      },
    })),
  };
}

/* ---------------- vstupy a DTO ---------------- */

export const OsvSettingsInput = z.object({
  ecosystems: z.array(z.enum(OSV_ECOSYSTEMS)).max(OSV_ECOSYSTEMS.length),
  autoRefresh: z.boolean(),
  baseUrl: z.string().trim().url().max(300),
});
/** Výsledek posledního stažení (běží na pozadí – ADR-100). */
export interface OsvLastResult {
  records: number;
  matches: number;
  errors: string[];
}
export type OsvSettings = z.infer<typeof OsvSettingsInput> & { lastRunAt: string | null; lastError: string | null; runningSince: string | null; lastResult: OsvLastResult | null };
export const OSV_DEFAULTS: OsvSettings = { ecosystems: [], autoRefresh: false, baseUrl: OSV_DEFAULT_BASE, lastRunAt: null, lastError: null, runningSince: null, lastResult: null };

export const CraFindingPatch = z.object({
  status: z.enum(VEX_STATUSES).optional(),
  justification: z.enum(VEX_JUSTIFICATIONS).nullable().optional(),
  impactStatement: z.string().trim().max(3000).nullable().optional(),
  actionStatement: z.string().trim().max(3000).nullable().optional(),
});
export const CraFindingInput = z.object({
  vulnId: z.string().trim().regex(/^[A-Za-z][\w.:-]{2,99}$/),
  componentRef: z.string().trim().min(1).max(500),
  summary: z.string().trim().max(1000).nullable().optional(),
});

export interface OsvStatusDto extends OsvSettings {
  counts: { ecosystem: string; records: number }[];
}
export interface CraFindingDto {
  id: string;
  productId: string;
  componentRef: string;
  componentName: string | null;
  componentVersion: string | null;
  vulnId: string;
  aliases: string[];
  cves: string[];
  summary: string | null;
  severity: string | null;
  source: "osv" | "manual" | "csaf" | "nvd";
  status: VexStatus;
  /** Stav podle oznámení výrobce (CSAF) – vlastní hodnocení `status` ho může přepsat (v1.16). */
  vendorStatus: VexStatus | null;
  justification: VexJustification | null;
  impactStatement: string | null;
  actionStatement: string | null;
  gone: boolean;
  kev: boolean;
  epss: number | null;
  /** Riziko založené z nálezu (v1.05). */
  riskId: string | null;
  firstSeen: string;
  updatedAt: string;
}

export const VEX_LABELS = {
  status: { under_investigation: "Prošetřuje se", affected: "Zasaženo", not_affected: "Nezasaženo", fixed: "Opraveno" } satisfies Record<VexStatus, string>,
  justification: {
    component_not_present: "Komponenta v produktu není",
    vulnerable_code_not_present: "Zranitelný kód v produktu není",
    vulnerable_code_not_in_execute_path: "Zranitelný kód se nevykonává",
    vulnerable_code_cannot_be_controlled_by_adversary: "Útočník zranitelný kód nemůže ovlivnit",
    inline_mitigations_already_exist: "Zranitelnost je zmírněna jiným opatřením",
  } satisfies Record<VexJustification, string>,
} as const;

/* ---------- vazby produktu na zbytek platformy (v1.05, ADR-101) ---------- */
export const CraLinksInput = z.object({
  assetIds: z.array(z.string().uuid()).max(200),
  supplierIds: z.array(z.string().uuid()).max(100),
  processIds: z.array(z.string().uuid()).max(100),
  riskIds: z.array(z.string().uuid()).max(200),
});
export type CraLinksInput = z.infer<typeof CraLinksInput>;
export interface CraLinksDto {
  assets: { id: string; name: string; assetType: string; healthStatus: string }[];
  suppliers: { id: string; name: string }[];
  processes: { id: string; label: string }[];
  risks: { id: string; label: string }[];
}
