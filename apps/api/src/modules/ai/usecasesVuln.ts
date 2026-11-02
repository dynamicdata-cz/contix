import { parseVulnTriageItems, type AiItem } from "@contix/shared";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { assets, assetVulnerabilities, vulnIntel, vulnScans } from "../../db/schema";
import type { PreparedRequest } from "./service";

/* ============================================================
 * Triáž nálezů ze skenu (v1.00, ADR-095): AI navrhne duplicity napříč skenery (i bez společné CVE – podle
 * významu názvu, CWE a endpointu), falešně pozitivní nálezy a nálezy k ověření. Bez názvů aktiv a osob
 * (aktiva jako A1, A2 s typem); ID ověřená proti kontextu; aplikace jen po rozhodnutí člověka.
 * ============================================================ */

const short = (t: string | null | undefined, n = 300) => (t ? (t.length > n ? `${t.slice(0, n)}…` : t) : null);
const SEV_RANK = sql`case ${assetVulnerabilities.severity} when 'critical' then 4 when 'high' then 3 when 'medium' then 2 when 'low' then 1 else 0 end`;

export async function prepareVulnScanTriage(db: Db, scanId: string, system: string, note: string, opts: { note?: string }): Promise<PreparedRequest | null> {
  const [scan] = await db.select().from(vulnScans).where(eq(vulnScans.id, scanId));
  if (!scan) return null;
  const cols = {
    id: assetVulnerabilities.id,
    assetId: assetVulnerabilities.assetId,
    scanner: assetVulnerabilities.scanner,
    sourceType: assetVulnerabilities.sourceType,
    vulnId: assetVulnerabilities.cveId,
    title: assetVulnerabilities.title,
    severity: assetVulnerabilities.severity,
    cvss: assetVulnerabilities.cvssScore,
    cwe: assetVulnerabilities.cwe,
    endpoint: assetVulnerabilities.endpoint,
    pkg: assetVulnerabilities.packageName,
    version: assetVulnerabilities.packageVersion,
    description: assetVulnerabilities.description,
    verified: assetVulnerabilities.verified,
    kev: vulnIntel.kev,
    epss: vulnIntel.epss,
  };
  const findings = await db
    .select(cols)
    .from(assetVulnerabilities)
    .leftJoin(vulnIntel, eq(vulnIntel.cveId, assetVulnerabilities.cveId))
    .where(and(eq(assetVulnerabilities.scanId, scan.id), eq(assetVulnerabilities.status, "open"), eq(assetVulnerabilities.verified, false)))
    .orderBy(desc(SEV_RANK), sql`${assetVulnerabilities.cvssScore} desc nulls last`)
    .limit(40);
  if (!findings.length) throw new Error("Import nemá otevřené neověřené nálezy k triáži.");
  const assetIds = [...new Set(findings.map((f) => f.assetId))];
  const candidates = await db
    .select(cols)
    .from(assetVulnerabilities)
    .leftJoin(vulnIntel, eq(vulnIntel.cveId, assetVulnerabilities.cveId))
    .where(
      and(
        inArray(assetVulnerabilities.assetId, assetIds),
        inArray(assetVulnerabilities.status, ["open", "accepted"]),
        sql`${assetVulnerabilities.duplicateOfId} is null`,
        sql`(${assetVulnerabilities.scanId} is null or ${assetVulnerabilities.scanId} <> ${scan.id})`,
        ne(assetVulnerabilities.scanner, scan.scanner),
      ),
    )
    .orderBy(desc(SEV_RANK))
    .limit(80);
  const as = await db.select({ id: assets.id, type: assets.assetType, cls: assets.assetClass, criticality: assets.criticality, internetFacing: assets.internetFacing, env: assets.environment }).from(assets).where(inArray(assets.id, assetIds));
  const alias = new Map(as.map((a, i) => [a.id, `A${i + 1}`]));
  const view = (f: (typeof findings)[number]) => ({
    findingId: f.id,
    asset: alias.get(f.assetId) ?? "?",
    source: f.scanner || f.sourceType,
    vulnId: f.vulnId,
    title: short(f.title, 200),
    severity: f.severity,
    cvss: f.cvss,
    cwe: f.cwe,
    endpoint: f.endpoint || null,
    component: f.pkg ? `${f.pkg} ${f.version}`.trim() : null,
    kev: !!f.kev,
    epss: f.epss,
    description: short(f.description),
  });
  const input = {
    scan: { scanner: scan.scanner, external: scan.external, name: short(scan.name, 200) },
    assets: as.map((a) => ({ asset: alias.get(a.id), type: a.type, class: a.cls, criticality: a.criticality, internetFacing: a.internetFacing, environment: a.env })),
    findings: findings.map(view),
    otherFindings: candidates.map(view),
  };
  const user = [
    "Proveď triáž nálezů z importu skeneru zranitelností. Pro každý nález z findings zvaž:",
    "duplicate = stejná slabina na stejném aktivu, kterou už hlásí nález z otherFindings (nebo jiný nález z findings) – i když se liší skener, název nebo ID (např. ZAP vs. Burp, Nessus vs. Wazuh); vyplň duplicateOfId;",
    "false_positive = nález zjevně neplatí pro dané aktivum (např. zranitelnost Windows na zařízení s Linuxem, verze komponenty mimo zasažený rozsah, informativní hlášení skeneru) – vždy s konkrétním zdůvodněním;",
    "verify = nález je reálný a závažný (KEV, vysoké EPSS, dosažitelný z internetu, kritické aktivum) a měl by se ověřit a řešit přednostně.",
    "Nálezy, u kterých si nejsi jistý, vynech. Používej jen findingId a duplicateOfId z podkladů.",
    "Schéma odpovědi:",
    '{"summary": "1–2 věty", "findings": [{"findingId": "…", "action": "duplicate", "duplicateOfId": "…", "reason": "proč"}]}',
    "Podklady (JSON):",
    JSON.stringify(input),
    note,
  ].join("\n");
  const label = (f: (typeof findings)[number]) => `${alias.get(f.assetId)} · ${f.vulnId}${f.title ? ` – ${f.title}` : ""}`.slice(0, 300);
  const known = new Map(findings.map((f) => [f.id, { title: label(f) }]));
  const cand = new Map(candidates.map((f) => [f.id, { title: `${label(f)} (${f.scanner || f.sourceType})`.slice(0, 300) }]));
  return {
    companyId: scan.companyId,
    entityType: "vuln_scan",
    entityName: scan.name || scan.fileName,
    input: { ...input, note: opts.note ?? null },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    validate: (raw) => {
      const r = parseVulnTriageItems(raw, known, cand);
      return { summary: r.summary, items: r.items.map((i) => ({ kind: "vuln_triage" as const, ...i })) };
    },
  };
}

/** Aplikace přijatých položek – stejné stavy jako ruční triáž; jen nálezy tohoto importu a jen otevřené. */
export async function applyVulnScanTriage(db: Db, scanId: string, chosen: AiItem[], userId: string | null) {
  let n = 0;
  for (const it of chosen) {
    if (it.kind !== "vuln_triage") continue;
    const reason = `AI návrh přijat: ${it.reason}`.slice(0, 2000);
    const set =
      it.action === "verify"
        ? { verified: true, triagedBy: userId, triagedAt: new Date() }
        : it.action === "duplicate"
          ? { status: "duplicate" as const, duplicateOfId: it.duplicateOfId, triageReason: reason, triagedBy: userId, triagedAt: new Date() }
          : { status: "false_positive" as const, triageReason: reason, triagedBy: userId, triagedAt: new Date() };
    const r = await db
      .update(assetVulnerabilities)
      .set(set)
      .where(and(eq(assetVulnerabilities.id, it.findingId), eq(assetVulnerabilities.scanId, scanId), eq(assetVulnerabilities.status, "open")))
      .returning({ id: assetVulnerabilities.id });
    n += r.length;
  }
  return { updatedFindings: n };
}
