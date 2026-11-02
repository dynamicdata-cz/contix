import { representativeId, SEVERITIES, VulnScanImportOptions, type ScanFinding, type Severity, type VulnScanHostDto, type VulnScanner, type VulnScanPreviewDto, type VulnScanStats } from "@contix/shared";
import { createHash } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { detectScanner, parseScan } from "./parsers";
import { decodeFile } from "./intel";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { assets, assetVulnerabilities, vulnIntel, vulnScans } from "../../db/schema";

/*
 * Import / reimport výstupu skeneru (ADR-095). Životní cyklus nálezu jako u Wazuhu a DefectDojo:
 *  - nález se páruje podle aktiva + `finding_key` (skener + pravidlo + endpoint + komponenta),
 *  - znovu nalezený vyřešený nález se znovu otevře, výjimka po termínu se otevře,
 *  - triáž (falešně pozitivní, mimo rozsah, duplicita) reimport nepřepíše,
 *  - s `closeMissing` se nálezy téhož skeneru na skenovaných aktivech, které v souboru chybí, označí jako vyřešené,
 *  - nový nález se stejnou CVE na aktivu, kterou už hlásí jiný zdroj, je automaticky duplicita.
 */

export const findingKeyOf = (scanner: VulnScanner, f: Pick<ScanFinding, "ruleId" | "endpoint" | "packageName" | "packageVersion">) =>
  createHash("sha256").update([scanner, f.ruleId, f.endpoint, f.packageName, f.packageVersion].join("\u0000")).digest("hex").slice(0, 40);

type AssetRow = { id: string; name: string; hostname: string | null; fqdn: string | null; ipAddresses: string[] };
const short = (h: string) => h.toLowerCase().split(".")[0]!;

/** Párování hostitelů ze skenu na aktiva společnosti: IP, FQDN, hostname, název, pak krátké jméno. */
export async function hostMatcher(db: Db, companyId: string) {
  const rows: AssetRow[] = await db
    .select({ id: assets.id, name: assets.name, hostname: assets.hostname, fqdn: assets.fqdn, ipAddresses: assets.ipAddresses })
    .from(assets)
    .where(and(eq(assets.companyId, companyId), sql`${assets.lifecycleStatus} <> 'retired'`));
  const exact = new Map<string, AssetRow>();
  const shortMap = new Map<string, AssetRow | null>();
  const put = (k: string | null | undefined, a: AssetRow) => {
    if (!k) return;
    const key = k.trim().toLowerCase();
    if (key && !exact.has(key)) exact.set(key, a);
    const s = short(key);
    if (s && !/^\d+$/.test(s)) shortMap.set(s, shortMap.has(s) && shortMap.get(s)?.id !== a.id ? null : a); // nejednoznačné krátké jméno = null
  };
  for (const a of rows) {
    for (const ip of a.ipAddresses) if (!exact.has(ip)) exact.set(ip, a);
    put(a.fqdn, a);
    put(a.hostname, a);
    put(a.name, a);
  }
  return (host: string, ip: string | null): AssetRow | null => {
    if (ip && exact.has(ip)) return exact.get(ip)!;
    const h = host.trim().toLowerCase();
    if (!h) return null;
    return exact.get(h) ?? shortMap.get(short(h)) ?? null;
  };
}

export interface PlannedScan {
  findings: ScanFinding[];
  skippedInfo: number;
  /** Nálezy s aktivem. */
  rows: { f: ScanFinding; assetId: string; key: string }[];
  hosts: VulnScanHostDto[];
  unmatched: number;
}

/** Rozdělí nálezy na aktiva (nebo na jedno cílové aktivum) a sloučí opakování v souboru. */
export async function planScan(db: Db, companyId: string, scanner: VulnScanner, all: ScanFinding[], opts: { assetId?: string | null; includeInfo?: boolean }): Promise<PlannedScan> {
  const findings = opts.includeInfo ? all : all.filter((f) => !f.info);
  const skippedInfo = all.length - findings.length;
  let target: AssetRow | null = null;
  if (opts.assetId) {
    const [a] = await db
      .select({ id: assets.id, name: assets.name, hostname: assets.hostname, fqdn: assets.fqdn, ipAddresses: assets.ipAddresses, companyId: assets.companyId })
      .from(assets)
      .where(eq(assets.id, opts.assetId));
    if (!a || a.companyId !== companyId) throw new Error("Cílové aktivum nepatří do zvolené společnosti.");
    target = a;
  }
  const match = target ? () => target : await hostMatcher(db, companyId);
  const hosts = new Map<string, VulnScanHostDto>();
  const rows = new Map<string, { f: ScanFinding; assetId: string; key: string }>();
  let unmatched = 0;
  const rank = (s: Severity) => SEVERITIES.length - SEVERITIES.indexOf(s);
  for (const f of findings) {
    const a = match(f.host, f.ip);
    const hk = `${f.host}|${f.ip ?? ""}`;
    const h = hosts.get(hk) ?? { host: f.host || (target ? "" : "?"), ip: f.ip, findings: 0, assetId: a?.id ?? null, assetName: a?.name ?? null };
    h.findings++;
    hosts.set(hk, h);
    if (!a) {
      unmatched++;
      continue;
    }
    const key = findingKeyOf(scanner, f);
    const id = `${a.id}|${key}`;
    const prev = rows.get(id);
    if (!prev || rank(f.severity) < rank(prev.f.severity)) rows.set(id, { f: prev ? { ...f, cves: [...new Set([...prev.f.cves, ...f.cves])].sort() } : f, assetId: a.id, key });
  }
  return { findings, skippedInfo, rows: [...rows.values()], hosts: [...hosts.values()].sort((a, b) => b.findings - a.findings), unmatched };
}

export function previewOf(scanner: VulnScanner, plan: PlannedScan): VulnScanPreviewDto {
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>;
  for (const f of plan.findings) bySeverity[f.severity]++;
  const order = (s: Severity) => SEVERITIES.indexOf(s);
  return {
    scanner,
    findings: plan.findings.length,
    skippedInfo: plan.skippedInfo,
    bySeverity,
    hosts: plan.hosts.slice(0, 200),
    sample: [...plan.findings]
      .sort((a, b) => order(a.severity) - order(b.severity))
      .slice(0, 15)
      .map((f) => ({ title: f.title, ruleId: f.ruleId, severity: f.severity, host: f.host, endpoint: f.endpoint, cves: f.cves.slice(0, 5) })),
  };
}

/** Zápis importu. Vrací ID importu a statistiku; volající pak přepočítá semafor. */
export async function commitScan(
  db: Db,
  input: { companyId: string; userId: string | null; scanner: VulnScanner; name: string; fileName: string; sha256: string; assetId: string | null; closeMissing: boolean; external: boolean; plan: PlannedScan; closeAllOfScanner?: boolean },
): Promise<{ scanId: string; stats: VulnScanStats }> {
  const { plan, scanner } = input;
  const scanStart = new Date();
  const unmatchedHosts = plan.hosts.filter((h) => !h.assetId).map((h) => h.host || h.ip || "?").slice(0, 200);
  return db.transaction(async (tx) => {
    const [scan] = await tx
      .insert(vulnScans)
      .values({
        companyId: input.companyId,
        scanner,
        name: input.name,
        fileName: input.fileName.slice(0, 255),
        fileSha256: input.sha256,
        assetId: input.assetId,
        external: input.external,
        closeMissing: input.closeMissing,
        importedById: input.userId,
        importedAt: scanStart,
        unmatchedHosts,
      })
      .returning({ id: vulnScans.id });
    const scanId = scan!.id;
    const assetIds = [...new Set(input.assetId ? [input.assetId] : plan.rows.map((r) => r.assetId))];

    // intel pro výběr reprezentativní CVE
    const cves = [...new Set(plan.rows.flatMap((r) => r.f.cves))];
    const intel = new Map<string, { kev: boolean; epss: number | null }>();
    for (let i = 0; i < cves.length; i += 1000)
      for (const r of await tx.select({ cveId: vulnIntel.cveId, kev: vulnIntel.kev, epss: vulnIntel.epss }).from(vulnIntel).where(inArray(vulnIntel.cveId, cves.slice(i, i + 1000)))) intel.set(r.cveId, r);

    // existující nálezy téhož skeneru na dotčených aktivech
    const existing = new Map<string, { cveId: string; status: string }>();
    for (let i = 0; i < assetIds.length; i += 1000)
      for (const r of await tx
        .select({ assetId: assetVulnerabilities.assetId, key: assetVulnerabilities.findingKey, cveId: assetVulnerabilities.cveId, status: assetVulnerabilities.status })
        .from(assetVulnerabilities)
        .where(and(eq(assetVulnerabilities.scanner, scanner), inArray(assetVulnerabilities.assetId, assetIds.slice(i, i + 1000)))))
        existing.set(`${r.assetId}|${r.key}`, r);

    const stats: VulnScanStats = { findings: plan.findings.length, skippedInfo: plan.skippedInfo, unmatched: plan.unmatched, created: 0, updated: 0, reopened: 0, closed: 0, duplicates: 0 };
    for (let i = 0; i < plan.rows.length; i += 500) {
      const chunk = plan.rows.slice(i, i + 500);
      const values = chunk.map(({ f, assetId, key }) => {
        const ex = existing.get(`${assetId}|${key}`);
        if (ex?.status === "resolved") stats.reopened++;
        // u existujícího nálezu se reprezentativní CVE nemění (stálá identita řádku)
        const cveId = ex?.cveId ?? representativeId(f, scanner, intel);
        return {
          assetId,
          cveId,
          severity: f.severity,
          cvssScore: f.cvss,
          packageName: f.packageName,
          packageVersion: f.packageVersion,
          description: f.description,
          reference: f.reference,
          detectedAt: scanStart,
          sourceType: "import" as const,
          firstSeenAt: scanStart,
          lastSeenAt: scanStart,
          findingKey: key,
          scanner,
          scanId,
          title: f.title,
          cwe: f.cwe,
          endpoint: f.endpoint,
          relatedCves: f.cves.filter((c) => c !== cveId).slice(0, 200),
          fixedVersion: f.fixedVersion,
          remediation: f.remediation,
          exposed: input.external,
        };
      });
      const res = await tx
        .insert(assetVulnerabilities)
        .values(values)
        .onConflictDoUpdate({
          target: [assetVulnerabilities.assetId, assetVulnerabilities.cveId, assetVulnerabilities.packageName, assetVulnerabilities.packageVersion, assetVulnerabilities.findingKey],
          set: {
            severity: sql`excluded.severity`,
            cvssScore: sql`excluded.cvss_score`,
            description: sql`excluded.description`,
            reference: sql`excluded.reference`,
            title: sql`excluded.title`,
            cwe: sql`excluded.cwe`,
            relatedCves: sql`excluded.related_cves`,
            fixedVersion: sql`excluded.fixed_version`,
            remediation: sql`excluded.remediation`,
            exposed: sql`${assetVulnerabilities.exposed} or excluded.exposed`,
            scanId: sql`excluded.scan_id`,
            lastSeenAt: scanStart,
            resolvedAt: sql`case when ${assetVulnerabilities.status} = 'resolved' then null else ${assetVulnerabilities.resolvedAt} end`,
            status: sql`case
              when ${assetVulnerabilities.status} = 'resolved' then 'open'::vuln_status
              when ${assetVulnerabilities.status} = 'accepted' and ${assetVulnerabilities.acceptedUntil} < current_date then 'open'::vuln_status
              else ${assetVulnerabilities.status} end`,
          },
        })
        .returning({ inserted: sql<boolean>`(xmax = 0)` });
      const created = res.filter((r) => r.inserted).length;
      stats.created += created;
      stats.updated += res.length - created;
    }

    // automatická duplicita: nový nález se stejnou CVE na aktivu, kterou už hlásí jiný zdroj
    const dup = await tx.execute(sql`
      update asset_vulnerabilities n
         set status = 'duplicate', duplicate_of_id = o.id,
             triage_reason = 'Automaticky: stejná zranitelnost na aktivu z jiného zdroje (' || coalesce(nullif(o.scanner, ''), o.source_type::text) || ')',
             triaged_at = now()
        from asset_vulnerabilities o
       where n.scan_id = ${scanId} and n.first_seen_at = ${scanStart.toISOString()}::timestamptz and n.status = 'open' and n.cve_id ~ '^CVE-'
         and o.asset_id = n.asset_id and o.cve_id = n.cve_id and o.id <> n.id and o.scanner <> n.scanner
         and o.status in ('open', 'accepted') and o.duplicate_of_id is null
      returning n.id`);
    stats.duplicates = (dup as unknown as unknown[]).length;

    // reimport: co v souboru chybí, je vyřešené (jen skenovaná aktiva a jen tento skener)
    // konektor (úplný stav zdroje): uzavřít chybějící na všech aktivech společnosti – jen když zdroj něco vrátil
    const scopeAll = input.closeAllOfScanner && plan.rows.length > 0;
    if (input.closeMissing && (assetIds.length || scopeAll)) {
      const closed = await tx
        .update(assetVulnerabilities)
        .set({ status: "resolved", resolvedAt: scanStart })
        .where(
          and(
            eq(assetVulnerabilities.scanner, scanner),
            scopeAll ? sql`${assetVulnerabilities.assetId} in (select id from assets where company_id = ${input.companyId})` : inArray(assetVulnerabilities.assetId, assetIds),
            inArray(assetVulnerabilities.status, ["open", "accepted"]),
            lt(assetVulnerabilities.lastSeenAt, scanStart),
          ),
        )
        .returning({ id: assetVulnerabilities.id });
      stats.closed = closed.length;
    }
    await tx.update(vulnScans).set({ stats: stats as unknown as Record<string, number> }).where(eq(vulnScans.id, scanId));
    return { scanId, stats };
  });
}

/** Zpracování multipart nahrání (UI i CI/CD): soubor + volby → náhled nebo zápis. Chyby vstupu = HTTP 400. */
export async function uploadScan(db: Db, body: Record<string, unknown>, companyOf: (requested?: string) => string, userId: string) {
  const file = body.file;
  if (!(file instanceof File) || file.size === 0) throw new HTTPException(400, { message: "Chybí soubor (pole „file“)" });
  const flag = (v: unknown) => (v === undefined ? undefined : ["1", "true", "on", "yes"].includes(String(v).toLowerCase()));
  const field = (k: string) => (typeof body[k] === "string" && body[k] !== "" ? (body[k] as string) : undefined);
  const parsed = VulnScanImportOptions.safeParse({
    scanner: field("scanner"),
    name: field("name"),
    assetId: field("assetId"),
    closeMissing: flag(body.closeMissing),
    external: flag(body.external),
    includeInfo: flag(body.includeInfo),
    mode: field("mode"),
  });
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.issues[0]?.message ?? "Neplatné volby importu" });
  const o = parsed.data;
  const companyId = companyOf(field("companyId"));
  const buf = new Uint8Array(await file.arrayBuffer());
  let text: string;
  try {
    text = decodeFile(buf);
  } catch (e) {
    throw new HTTPException(400, { message: (e as Error).message });
  }
  const scanner: VulnScanner | null = o.scanner ?? detectScanner(text, file.name);
  if (!scanner || scanner === "defectdojo") throw new HTTPException(400, { message: "Formát souboru se nepodařilo rozpoznat – zvolte skener." });
  let plan: PlannedScan;
  try {
    plan = await planScan(db, companyId, scanner, parseScan(text, scanner), { assetId: o.assetId, includeInfo: o.includeInfo });
  } catch (e) {
    throw new HTTPException(400, { message: (e as Error).message });
  }
  if (o.mode === "preview") return { kind: "preview" as const, preview: previewOf(scanner, plan) };
  const r = await commitScan(db, {
    companyId,
    userId,
    scanner,
    name: o.name || file.name,
    fileName: file.name,
    sha256: createHash("sha256").update(buf).digest("hex"),
    assetId: o.assetId ?? null,
    closeMissing: o.closeMissing,
    external: o.external,
    plan,
  });
  return { kind: "commit" as const, r, scanner, file };
}
