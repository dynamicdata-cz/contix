import { z } from "zod";
import { compareVersions, VEX_JUSTIFICATIONS, type VexJustification, type VexStatus } from "./craVuln";

/* ============================================================
 * CRA – dovozce a distributor (v1.16, ADR-113).
 * Kontrola dokladů výrobce před dodáním na trh (čl. 19 odst. 2, čl. 20 odst. 2, příloha II),
 * zranitelnosti produktů bez SBOM: oznámení výrobce ve formátu CSAF 2.0 (jen nahrání souboru, nic se neodesílá)
 * a volitelné dohledání podle CPE v databázi NVD (výslovně zapnuté – odchází jen identifikátor CPE produktu).
 * ============================================================ */

/* ---------------- kontrola dokladů ---------------- */

export const CRA_SUPPLY_CHECK_STATUSES = ["missing", "ok", "na"] as const;
export type CraSupplyCheckStatus = (typeof CRA_SUPPLY_CHECK_STATUSES)[number];

type SupplyRole = "importer" | "distributor";
export const CRA_SUPPLY_CHECKS: { key: string; ref: string; roles: SupplyRole[]; optional?: boolean }[] = [
  { key: "ce_marking", ref: "čl. 19 odst. 2, čl. 20 odst. 2 a)", roles: ["importer", "distributor"] },
  { key: "eu_doc", ref: "čl. 28, příl. V / VI", roles: ["importer", "distributor"] },
  { key: "tech_doc", ref: "čl. 19 odst. 2 b)", roles: ["importer"] },
  { key: "conformity_done", ref: "čl. 19 odst. 2 a)", roles: ["importer"] },
  { key: "info_manufacturer", ref: "příl. II bod 1", roles: ["importer", "distributor"] },
  { key: "info_vuln_contact", ref: "příl. II bod 2", roles: ["importer", "distributor"] },
  { key: "info_identification", ref: "příl. II bod 3", roles: ["importer", "distributor"] },
  { key: "info_purpose", ref: "příl. II bod 4–5", roles: ["importer", "distributor"] },
  { key: "info_support_end", ref: "příl. II bod 7", roles: ["importer", "distributor"] },
  { key: "info_instructions", ref: "příl. II bod 8", roles: ["importer", "distributor"] },
  { key: "importer_details", ref: "čl. 19 odst. 4, čl. 20 odst. 2 b)", roles: ["importer", "distributor"] },
  { key: "sbom_location", ref: "příl. II bod 9", roles: ["importer", "distributor"], optional: true },
];

export interface CraSupplyCheckState {
  status: CraSupplyCheckStatus;
  note: string | null;
  /** Odkaz na doklad (URL prohlášení o shodě, portál výrobce…). */
  url: string | null;
  /** Datum ověření (YYYY-MM-DD). */
  at: string | null;
  byName: string | null;
}
export interface CraProductFileDto {
  id: string;
  checkKey: string | null;
  fileName: string;
  fileSize: number;
  sha256: string;
  uploadedByName: string | null;
  createdAt: string;
}
export interface CraSupplyCheckItem extends CraSupplyCheckState {
  key: string;
  ref: string;
  optional: boolean;
  files: CraProductFileDto[];
}

export const isSupplyRole = (role: string): role is SupplyRole => role === "importer" || role === "distributor";

export function craSupplyChecksFor(role: string, states: Record<string, Partial<CraSupplyCheckState> | undefined>, files: CraProductFileDto[] = []): CraSupplyCheckItem[] {
  if (!isSupplyRole(role)) return [];
  return CRA_SUPPLY_CHECKS.filter((c) => c.roles.includes(role)).map((c) => {
    const s = states[c.key] ?? {};
    return {
      key: c.key,
      ref: c.ref,
      optional: !!c.optional,
      status: (s.status as CraSupplyCheckStatus) ?? "missing",
      note: s.note ?? null,
      url: s.url ?? null,
      at: s.at ?? null,
      byName: s.byName ?? null,
      files: files.filter((f) => f.checkKey === c.key),
    };
  });
}

/** Povinné doklady, které ještě nejsou ověřené (nepovinné a „netýká se“ se nepočítají). */
export const supplyChecksOpen = (items: CraSupplyCheckItem[]) => items.filter((i) => !i.optional && i.status === "missing").length;

export const CraSupplyCheckInput = z.object({
  status: z.enum(CRA_SUPPLY_CHECK_STATUSES),
  note: z.string().trim().max(3000).nullable().optional(),
  url: z
    .string()
    .trim()
    .max(1000)
    .regex(/^https?:\/\//i, "Odkaz musí začínat http:// nebo https://")
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
});
export type CraSupplyCheckInput = z.input<typeof CraSupplyCheckInput>;

/* ---------------- CPE 2.3 ---------------- */

export interface Cpe {
  part: "a" | "o" | "h";
  vendor: string;
  product: string;
  version: string;
}
/** Formátovaný řetězec CPE 2.3 (cpe:2.3:part:vendor:product:version:…); zbývající pole volitelná. */
export const CPE_RE = /^cpe:2\.3:[aoh](?::(?:[^:\\]|\\.)*){2,11}$/i;

const cpeFields = (s: string) => {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "\\" && i + 1 < s.length) {
      cur += s[++i];
      continue;
    }
    if (ch === ":") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
};

export function parseCpe(s: string | null | undefined): Cpe | null {
  const v = s?.trim();
  if (!v || !CPE_RE.test(v)) return null;
  const f = cpeFields(v);
  return { part: f[2]!.toLowerCase() as Cpe["part"], vendor: (f[3] ?? "*").toLowerCase(), product: (f[4] ?? "*").toLowerCase(), version: (f[5] ?? "*").toLowerCase() || "*" };
}

const any = (x: string) => x === "*" || x === "-" || x === "";
/** Shoda dvou CPE (výrobce a produkt přesně, verze přesně nebo zástupný znak v jednom z nich). */
export function cpeMatches(a: Cpe, b: Cpe): boolean {
  if (a.part !== b.part || a.vendor !== b.vendor || a.product !== b.product) return false;
  return any(a.version) || any(b.version) || a.version === b.version;
}
/** Řetězec pro dotaz do NVD (verze produktu doplní zástupný znak). */
export function cpeQuery(cpe: string, version: string | null): string | null {
  const c = parseCpe(cpe);
  if (!c) return null;
  const v = any(c.version) && version ? version.toLowerCase().replace(/[^\w.+~-]/g, "") || "*" : c.version;
  return `cpe:2.3:${c.part}:${c.vendor}:${c.product}:${v}:*:*:*:*:*:*:*`;
}

/* ---------------- CSAF 2.0 ---------------- */

export interface CsafProduct {
  id: string;
  name: string;
  vendor: string | null;
  productName: string | null;
  version: string | null;
  /** Rozsah verzí (vers:…/<1.2.3|>=1.0) – větev product_version_range. */
  range: string | null;
  cpe: string | null;
  purl: string | null;
}
export interface CsafVulnerability {
  id: string;
  cve: string | null;
  title: string | null;
  summary: string | null;
  severity: string | null;
  /** Stav podle produktu (ID produktu CSAF → stav VEX). */
  status: Record<string, VexStatus>;
  justification: Record<string, VexJustification>;
  action: Record<string, string>;
}
export interface CsafAdvisory {
  publisher: string;
  namespace: string;
  trackingId: string;
  version: string;
  title: string;
  initialRelease: string | null;
  currentRelease: string | null;
  products: CsafProduct[];
  vulnerabilities: CsafVulnerability[];
}

const s = (v: unknown, max = 1000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

const STATUS_MAP: Record<string, VexStatus> = {
  known_affected: "affected",
  first_affected: "affected",
  last_affected: "affected",
  fixed: "fixed",
  first_fixed: "fixed",
  known_not_affected: "not_affected",
  under_investigation: "under_investigation",
};
const STATUS_RANK: Record<VexStatus, number> = { affected: 4, under_investigation: 3, fixed: 2, not_affected: 1 };

/** Oznámení výrobce ve formátu CSAF 2.0 (JSON) – jen čtení souboru. Vyhodí chybu, pokud to CSAF není. */
export function parseCsaf(text: string): CsafAdvisory {
  const j = JSON.parse(text);
  const d = j?.document;
  if (!d || typeof d.csaf_version !== "string" || !d.tracking || !d.publisher) throw new Error("not CSAF");
  const products = new Map<string, CsafProduct>();
  const add = (fpn: any, ctx: { vendor: string | null; productName: string | null; version: string | null; range: string | null }) => {
    const id = s(fpn?.product_id, 200);
    if (!id) return;
    const h = fpn.product_identification_helper ?? {};
    products.set(id, { id, name: s(fpn.name, 500) ?? id, ...ctx, cpe: s(h.cpe, 500), purl: s(h.purl, 500) });
  };
  const walk = (branches: unknown, ctx: { vendor: string | null; productName: string | null; version: string | null; range: string | null }) => {
    for (const b of arr(branches)) {
      const next = { ...ctx };
      const name = s(b?.name, 300);
      if (b?.category === "vendor") next.vendor = name;
      else if (b?.category === "product_name" || b?.category === "product_family") next.productName = name;
      else if (b?.category === "product_version") next.version = name;
      else if (b?.category === "product_version_range") next.range = name;
      if (b?.product) add(b.product, next);
      walk(b?.branches, next);
    }
  };
  const tree = j.product_tree ?? {};
  walk(tree.branches, { vendor: null, productName: null, version: null, range: null });
  for (const f of arr(tree.full_product_names)) add(f, { vendor: null, productName: null, version: null, range: null });
  for (const r of arr(tree.relationships)) if (r?.full_product_name) add(r.full_product_name, { ...(products.get(r.product_reference) ?? { vendor: null, productName: null, version: null, range: null }) });
  const groups = new Map<string, string[]>(arr(tree.product_groups).map((g: any) => [String(g?.group_id), arr(g?.product_ids).map(String)]));
  const idsOf = (x: any) => [...arr(x?.product_ids).map(String), ...arr(x?.group_ids).flatMap((g) => groups.get(String(g)) ?? [])];

  const vulnerabilities: CsafVulnerability[] = [];
  for (const v of arr(j.vulnerabilities)) {
    const cve = s(v?.cve, 30)?.toUpperCase() ?? null;
    const id = cve ?? s(arr(v?.ids)[0]?.text, 100) ?? null;
    if (!id) continue;
    const status: Record<string, VexStatus> = {};
    for (const [k, list] of Object.entries(v?.product_status ?? {})) {
      const st = STATUS_MAP[k];
      if (!st) continue;
      for (const pid of arr(list).map(String)) if (!status[pid] || STATUS_RANK[st] > STATUS_RANK[status[pid]!]) status[pid] = st;
    }
    const justification: Record<string, VexJustification> = {};
    for (const f of arr(v?.flags)) if ((VEX_JUSTIFICATIONS as readonly string[]).includes(f?.label)) for (const pid of idsOf(f)) justification[pid] = f.label;
    const action: Record<string, string> = {};
    for (const r of arr(v?.remediations)) {
      const txt = [s(r?.category, 40) && REMEDIATION_LABEL[r.category as string], s(r?.details, 1500), s(r?.url, 500)].filter(Boolean).join(" – ");
      if (txt) for (const pid of idsOf(r)) action[pid] = action[pid] ? `${action[pid]}\n${txt}`.slice(0, 3000) : txt;
    }
    let severity: string | null = null;
    for (const sc of arr(v?.scores)) {
      const c = sc?.cvss_v3 ?? sc?.cvss_v4 ?? sc?.cvss_v2;
      const base = typeof c?.baseScore === "number" ? c.baseScore : null;
      if (base != null && (severity == null || base > Number(severity.split(" ")[0]))) severity = `${base}${c.baseSeverity ? ` ${String(c.baseSeverity).toUpperCase()}` : ""}`;
    }
    const summary = arr(v?.notes).find((n: any) => n?.category === "summary" || n?.category === "description");
    vulnerabilities.push({ id: id.slice(0, 100), cve, title: s(v?.title, 500), summary: s(summary?.text, 1000), severity, status, justification, action });
  }
  return {
    publisher: s(d.publisher?.name, 300) ?? "?",
    namespace: s(d.publisher?.namespace, 300) ?? "",
    trackingId: s(d.tracking?.id, 200) ?? "?",
    version: s(d.tracking?.version, 50) ?? "1",
    title: s(d.title, 500) ?? s(d.tracking?.id, 200) ?? "CSAF",
    initialRelease: s(d.tracking?.initial_release_date, 40),
    currentRelease: s(d.tracking?.current_release_date, 40),
    products: [...products.values()],
    vulnerabilities,
  };
}

const REMEDIATION_LABEL: Record<string, string> = {
  vendor_fix: "Oprava výrobce",
  mitigation: "Zmírnění",
  workaround: "Náhradní řešení",
  none_available: "Oprava není k dispozici",
  no_fix_planned: "Oprava se neplánuje",
};

const norm = (x: string | null | undefined) =>
  (x ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9.]+/g, " ")
    .trim();

/** Verze v rozsahu „vers:<schéma>/<omezení>|…“ (podmnožina: =, <, <=, >, >=, *). */
export function inVersRange(range: string, version: string): boolean | null {
  const m = /^vers:[^/]+\/(.+)$/i.exec(range.trim());
  if (!m) return null;
  const parts = m[1]!.split("|").map((x) => x.trim()).filter(Boolean);
  if (parts.includes("*")) return true;
  const cons = parts.map((p) => {
    const mm = /^(<=|>=|<|>|!=|=)?\s*(.+)$/.exec(p)!;
    return { op: mm[1] ?? "=", v: mm[2]! };
  });
  if (cons.some((c) => c.op === "=" && compareVersions(version, c.v) === 0)) return true;
  if (cons.some((c) => c.op === "!=" && compareVersions(version, c.v) === 0)) return false;
  const bounds = cons.filter((c) => c.op !== "=" && c.op !== "!=");
  if (!bounds.length) return false;
  return bounds.every((c) => {
    const r = compareVersions(version, c.v);
    return c.op === "<" ? r < 0 : c.op === "<=" ? r <= 0 : c.op === ">" ? r > 0 : r >= 0;
  });
}

/**
 * Patří položka CSAF k produktu? Přednost má shoda CPE; jinak název (výrobce + produkt) a verze.
 * Bez verze produktu stačí shoda názvu (konzervativně – nález se ověří ručně).
 */
export function csafProductMatches(p: { name: string; version: string | null; cpe: string | null; manufacturerName: string | null }, x: CsafProduct): boolean {
  const pc = parseCpe(p.cpe);
  const xc = parseCpe(x.cpe);
  const version = p.version ?? (pc && !any(pc.version) ? pc.version : null);
  if (pc && xc) {
    if (pc.part !== xc.part || pc.vendor !== xc.vendor || pc.product !== xc.product) return false;
    if (!any(xc.version)) return !version || compareVersions(version, xc.version) === 0;
    // CPE bez verze v CSAF – rozhodne verze / rozsah z větví
  } else {
    const want = norm(p.name);
    if (!want) return false;
    const have = norm([x.productName, x.name].filter(Boolean).join(" "));
    const mf = norm(p.manufacturerName);
    const vendorOk = !mf || !x.vendor || norm(x.vendor).includes(mf.split(" ")[0]!) || mf.includes(norm(x.vendor));
    if (!vendorOk || !(` ${have} `.includes(` ${want} `) || norm(x.productName) === want)) return false;
  }
  if (!version) return true;
  if (x.range) return inVersRange(x.range, version) ?? true;
  if (x.version) return compareVersions(version, x.version) === 0;
  // verze jen v názvu položky („Router X 4.2“); bez čísla verze v názvu = celý produkt
  const tokens = norm(x.name).split(" ");
  return tokens.includes(norm(version)) || !tokens.some((t) => /^\d+(\.\d+)+/.test(t));
}

/** Nálezy produktu z oznámení: stav podle nejhoršího ze shodných položek CSAF. */
export function csafFindingsFor(p: { name: string; version: string | null; cpe: string | null; manufacturerName: string | null }, a: CsafAdvisory): { vulnId: string; aliases: string[]; summary: string | null; severity: string | null; status: VexStatus; justification: VexJustification | null; action: string | null }[] {
  const ids = a.products.filter((x) => csafProductMatches(p, x)).map((x) => x.id);
  if (!ids.length) return [];
  const out = [];
  for (const v of a.vulnerabilities) {
    let st: VexStatus | null = null;
    let pid: string | null = null;
    for (const id of ids) {
      const x = v.status[id];
      if (x && (!st || STATUS_RANK[x] > STATUS_RANK[st])) {
        st = x;
        pid = id;
      }
    }
    if (!st || !pid) continue;
    out.push({
      vulnId: v.id,
      aliases: v.cve && v.cve !== v.id ? [v.cve] : [],
      summary: [v.title, v.summary].filter(Boolean).join(" – ").slice(0, 1000) || null,
      severity: v.severity,
      status: st,
      justification: st === "not_affected" ? (v.justification[pid] ?? "component_not_present") : null,
      action: v.action[pid] ?? null,
    });
  }
  return out;
}

export const csafRef = (a: { namespace: string; trackingId: string }) => `csaf:${a.namespace.replace(/^https?:\/\//i, "").replace(/\/+$/, "")}/${a.trackingId}`.slice(0, 500);
export const cpeRef = (cpe: string) => `cpe:${cpe}`.slice(0, 500);

export interface CraAdvisoryDto {
  id: string;
  companyId: string;
  publisher: string;
  trackingId: string;
  version: string;
  title: string;
  currentRelease: string | null;
  products: number;
  vulnerabilities: number;
  /** Produkty organizace, kterých se oznámení týká. */
  matchedProducts: { id: string; name: string }[];
  uploadedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ---------------- NVD (volitelně, podle CPE) ---------------- */

export const NVD_DEFAULT_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0";
export const NvdSettingsInput = z.object({ enabled: z.boolean(), baseUrl: z.string().trim().url().max(300) });
export type NvdSettings = z.infer<typeof NvdSettingsInput>;
export const NVD_DEFAULTS: NvdSettings = { enabled: false, baseUrl: NVD_DEFAULT_URL };

/** Odpověď NVD CVE API 2.0 → záznamy (jen ID, popis, závažnost). */
export function parseNvdCves(json: unknown): { items: { id: string; summary: string | null; severity: string | null }[]; total: number } {
  const j = json as any;
  const items = arr(j?.vulnerabilities)
    .map((v) => v?.cve)
    .filter((c) => typeof c?.id === "string" && /^CVE-\d{4}-\d{4,}$/i.test(c.id))
    .map((c) => {
      const d = arr(c.descriptions).find((x: any) => x?.lang === "en") ?? arr(c.descriptions)[0];
      const m = c.metrics ?? {};
      const best = [...arr(m.cvssMetricV40), ...arr(m.cvssMetricV31), ...arr(m.cvssMetricV30), ...arr(m.cvssMetricV2)][0]?.cvssData;
      return { id: String(c.id).toUpperCase(), summary: s(d?.value, 1000), severity: typeof best?.baseScore === "number" ? `${best.baseScore}${best.baseSeverity ? ` ${best.baseSeverity}` : ""}` : null };
    });
  return { items, total: typeof j?.totalResults === "number" ? j.totalResults : items.length };
}

export const CRA_SUPPLY_LABELS = {
  check: {
    ce_marking: "Označení CE na produktu",
    eu_doc: "EU prohlášení o shodě (nebo zjednodušené s odkazem)",
    tech_doc: "Technická dokumentace výrobce je vypracovaná",
    conformity_done: "Výrobce provedl posouzení shody",
    info_manufacturer: "Jméno, adresa a kontakt výrobce",
    info_vuln_contact: "Kontaktní místo pro hlášení zranitelností",
    info_identification: "Identifikace produktu (typ, verze)",
    info_purpose: "Účel použití a známá rizika",
    info_support_end: "Datum konce podpory výrobce",
    info_instructions: "Bezpečnostní pokyny (instalace, aktualizace, vyřazení)",
    importer_details: "Údaje dovozce (výrobce mimo EU)",
    sbom_location: "Kde je SBOM (pokud ho výrobce zpřístupňuje)",
  } satisfies Record<string, string>,
  status: { missing: "Chybí", ok: "Ověřeno", na: "Netýká se" } satisfies Record<CraSupplyCheckStatus, string>,
} as const;
