import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { assetVulnerabilities, secTestFindings } from "../../db/schema";

/* ============================================================
 * CVE z bezpečnostních testů do evidence zranitelností (v1.67, ADR-160).
 * Nález testu s identifikátorem CVE na aktivu se zrcadlí jako zranitelnost aktiva (skener „sectest“, klíč nálezu):
 * stav podle nálezu (otevřený / přijatý / opravený / falešný), hlásí-li stejnou CVE na aktivu jiný zdroj, je zrcadlo
 * duplicita – evidence zranitelností tak nepočítá jednu CVE dvakrát a lhůty oprav, P1/KEV a semafor platí i pro testy.
 * ============================================================ */

export const SECTEST_SCANNER = "sectest";
const CVE_RE = /CVE-\d{4}-\d{4,7}/gi;
const VSTATUS: Record<string, "open" | "accepted" | "resolved" | "false_positive"> = { open: "open", accepted: "accepted", fixed: "resolved", false_positive: "false_positive" };

export const cvesOf = (...texts: (string | null | undefined)[]) => [...new Set(texts.flatMap((t) => (t ?? "").match(CVE_RE) ?? []).map((c) => c.toUpperCase()))];

/** Zrcadlení CVE nálezů testů společnosti (volitelně jen vybraných nálezů). Vrací počet zapsaných zranitelností. */
export async function mirrorSecTestCves(db: Db, companyId: string, findingIds?: string[], now = new Date()): Promise<number> {
  const rows = await db
    .select()
    .from(secTestFindings)
    .where(and(eq(secTestFindings.companyId, companyId), sql`(${secTestFindings.code} || ' ' || ${secTestFindings.title} || ' ' || ${secTestFindings.detail}) ~* 'CVE-[0-9]{4}-[0-9]{4,}'`, findingIds ? inArray(secTestFindings.id, findingIds.length ? findingIds : ["00000000-0000-0000-0000-000000000000"]) : undefined));
  let n = 0;
  for (const f of rows) {
    const cves = cvesOf(f.code, f.title, f.detail);
    const key = `st:${f.key}`.slice(0, 64);
    if (!cves.length) continue;
    if (!f.assetId) {
      // nález ztratil aktivum → jeho zrcadla nejsou zranitelností žádného aktiva
      await db.delete(assetVulnerabilities).where(and(eq(assetVulnerabilities.scanner, SECTEST_SCANNER), eq(assetVulnerabilities.findingKey, key)));
      continue;
    }
    // aktivum se změnilo → zrcadla na starém aktivu pryč
    await db.delete(assetVulnerabilities).where(and(eq(assetVulnerabilities.scanner, SECTEST_SCANNER), eq(assetVulnerabilities.findingKey, key), sql`${assetVulnerabilities.assetId} <> ${f.assetId}`));
    const status = VSTATUS[f.status] ?? "open";
    const endpoint = `${f.host}${f.port ? `:${f.port}` : ""}`.slice(0, 500);
    for (const cve of cves) {
      await db
        .insert(assetVulnerabilities)
        .values({
          assetId: f.assetId,
          cveId: cve,
          severity: (["critical", "high", "medium", "low"].includes(f.severity) ? f.severity : "unknown") as "critical",
          packageName: "",
          packageVersion: "",
          description: f.detail || null,
          sourceType: "import",
          scanner: SECTEST_SCANNER,
          findingKey: key,
          title: f.title.slice(0, 500),
          endpoint,
          relatedCves: cves.filter((c) => c !== cve).slice(0, 50),
          status,
          acceptedBy: status === "accepted" ? f.acceptedById : null,
          acceptedReason: status === "accepted" ? f.note : null,
          acceptedUntil: status === "accepted" ? f.acceptedUntil : null,
          firstSeenAt: f.firstSeenAt,
          lastSeenAt: f.lastSeenAt,
          resolvedAt: status === "resolved" ? (f.fixedAt ?? now) : null,
        })
        .onConflictDoUpdate({
          target: [assetVulnerabilities.assetId, assetVulnerabilities.cveId, assetVulnerabilities.packageName, assetVulnerabilities.packageVersion, assetVulnerabilities.findingKey],
          set: {
            severity: sql`excluded.severity`,
            title: sql`excluded.title`,
            description: sql`excluded.description`,
            endpoint: sql`excluded.endpoint`,
            lastSeenAt: f.lastSeenAt,
            // duplicita zůstává duplicitou, dokud je nález otevřený
            status: sql`case when ${assetVulnerabilities.status} = 'duplicate' and excluded.status = 'open' then 'duplicate'::vuln_status else excluded.status end`,
            acceptedBy: sql`excluded.accepted_by`,
            acceptedReason: sql`excluded.accepted_reason`,
            acceptedUntil: sql`excluded.accepted_until`,
            resolvedAt: sql`excluded.resolved_at`,
          },
        });
      n++;
    }
  }
  // původní záznam už není otevřený → zrcadlo zpět na otevřené
  await db.execute(sql`
    update asset_vulnerabilities n set status = 'open', duplicate_of_id = null, triage_reason = null, triaged_at = null
      from assets a
     where n.scanner = ${SECTEST_SCANNER} and n.status = 'duplicate' and a.id = n.asset_id and a.company_id = ${companyId}
       and not exists (select 1 from asset_vulnerabilities o where o.id = n.duplicate_of_id and o.status in ('open', 'accepted'))`);
  // stejná CVE na aktivu z jiného zdroje → zrcadlo testu je duplicita
  await db.execute(sql`
    update asset_vulnerabilities n
       set status = 'duplicate', duplicate_of_id = o.id,
           triage_reason = 'Automaticky: stejná zranitelnost na aktivu z jiného zdroje (' || coalesce(nullif(o.scanner, ''), o.source_type::text) || ')',
           triaged_at = now()
      from asset_vulnerabilities o, assets a
     where n.scanner = ${SECTEST_SCANNER} and n.status = 'open' and a.id = n.asset_id and a.company_id = ${companyId}
       and o.asset_id = n.asset_id and o.cve_id = n.cve_id and o.id <> n.id and o.scanner <> ${SECTEST_SCANNER}
       and o.status in ('open', 'accepted') and o.duplicate_of_id is null`);
  return n;
}

/**
 * TLS test → inventář certifikátů (v1.67, ADR-160): každý cíl testu TLS, který odpověděl, se zapíše jako koncový bod
 * kontroly certifikátu (pokud tam ještě není) – hlídání platnosti a kryptografie pak běží průběžně, ne jen při testu.
 */
export async function registerTlsEndpoints(db: Db, companyId: string, targets: { host: string; port: number | null; assetId: string | null }[]) {
  const { HOST_RE } = await import("@contix/shared");
  const { tlsEndpoints } = await import("../../db/schema");
  let n = 0;
  for (const t of targets) {
    const host = t.host.trim().toLowerCase();
    if (!HOST_RE.test(host)) continue;
    const r = await db
      .insert(tlsEndpoints)
      .values({ companyId, host, port: t.port ?? 443, assetId: t.assetId, note: "Založeno z bezpečnostního testu TLS", enabled: true })
      .onConflictDoUpdate({ target: [tlsEndpoints.companyId, tlsEndpoints.host, tlsEndpoints.port], set: { assetId: sql`coalesce(${tlsEndpoints.assetId}, excluded.asset_id)` } })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    if (r[0]?.inserted) n++;
  }
  return n;
}
