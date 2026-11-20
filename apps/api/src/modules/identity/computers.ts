import { COMPUTER_RULES, defaultAssetClass, evaluateComputers, type DirComputer, type IdentityPolicy, type IdentitySeverity } from "@contix/shared";
import { and, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { assets, assetSources, connections, hostInventories, identityComputers } from "../../db/schema";

/* ============================================================
 * Počítače a servery z AD (v1.90, ADR-185): zápis inventáře, párování s aktivy (jen jednoznačná shoda podle
 * jména / DNS ve společnosti zdroje, bez přepisu údajů aktiva), sběr dat přes aktivum a nálezy.
 * ============================================================ */

export interface ComputerFindingRow {
  accountId: null;
  computerId: string | null;
  subject: string;
  rule: string;
  severity: IdentitySeverity;
  detail: string;
}

type Row = { id: string; companyId: string };
const shortName = (s: string) => s.toLowerCase().split(".")[0]!;

/** Sběr dat o aktivech: agent CONTIX (koncentrátor), sběrač, Wazuh. */
export async function monitoringOf(db: Db, assetIds: string[]): Promise<Map<string, Set<"agent" | "collector" | "wazuh">>> {
  const out = new Map<string, Set<"agent" | "collector" | "wazuh">>();
  if (!assetIds.length) return out;
  const add = (id: string, k: "agent" | "collector" | "wazuh") => (out.get(id) ?? out.set(id, new Set()).get(id)!).add(k);
  const [inv, wz] = await Promise.all([
    db
      .select({ assetId: hostInventories.assetId, kind: connections.kind })
      .from(hostInventories)
      .innerJoin(connections, eq(connections.id, hostInventories.connectionId))
      .where(and(isNotNull(hostInventories.assetId), inArray(hostInventories.assetId, assetIds))),
    db.selectDistinct({ assetId: assetSources.assetId }).from(assetSources).where(and(eq(assetSources.sourceType, "wazuh"), inArray(assetSources.assetId, assetIds))),
  ]);
  for (const r of inv) add(r.assetId!, r.kind === "concentrator" ? "agent" : "collector");
  for (const r of wz) add(r.assetId, "wazuh");
  return out;
}

/** Zápis počítačů ze synchronizace; zmizelé se označí jako odstraněné. Vrací externalId → id. */
export async function storeComputers(db: Db, row: Row, list: DirComputer[], now: Date) {
  const unique = [...new Map(list.map((c) => [c.externalId, c])).values()];
  const ids = new Map<string, string>();
  for (let i = 0; i < unique.length; i += 500) {
    const part = unique.slice(i, i + 500);
    const rows = await db
      .insert(identityComputers)
      .values(
        part.map((c) => ({
          sourceId: row.id,
          companyId: row.companyId,
          externalId: c.externalId,
          name: c.name.slice(0, 255),
          dnsName: c.dnsName?.slice(0, 255) ?? null,
          dn: c.dn,
          os: c.os?.slice(0, 255) ?? null,
          osVersion: c.osVersion?.slice(0, 100) ?? null,
          role: c.role,
          enabled: c.enabled,
          lastLogonAt: c.lastLogonAt,
          pwdLastSetAt: c.pwdLastSetAt,
          dirCreatedAt: c.createdAt,
          description: c.description,
          spns: c.spns,
          unconstrainedDelegation: c.unconstrainedDelegation,
          constrainedDelegation: c.constrainedDelegation,
          laps: c.laps,
          firstSeenAt: now,
          lastSeenAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [identityComputers.sourceId, identityComputers.externalId],
        set: {
          companyId: row.companyId,
          name: sql`excluded.name`,
          dnsName: sql`excluded.dns_name`,
          dn: sql`excluded.dn`,
          os: sql`excluded.os`,
          osVersion: sql`excluded.os_version`,
          role: sql`excluded.role`,
          enabled: sql`excluded.enabled`,
          lastLogonAt: sql`excluded.last_logon_at`,
          pwdLastSetAt: sql`excluded.pwd_last_set_at`,
          dirCreatedAt: sql`excluded.dir_created_at`,
          description: sql`excluded.description`,
          spns: sql`excluded.spns`,
          unconstrainedDelegation: sql`excluded.unconstrained_delegation`,
          constrainedDelegation: sql`excluded.constrained_delegation`,
          laps: sql`excluded.laps`,
          lastSeenAt: now,
          removedAt: null,
        },
      })
      .returning({ id: identityComputers.id, externalId: identityComputers.externalId });
    for (const r of rows) ids.set(r.externalId, r.id);
  }
  const removed = await db
    .update(identityComputers)
    .set({ removedAt: now })
    .where(and(eq(identityComputers.sourceId, row.id), lt(identityComputers.lastSeenAt, now), isNull(identityComputers.removedAt)))
    .returning({ id: identityComputers.id });
  return { ids, removed: removed.length };
}

/**
 * Párování počítačů bez aktiva s aktivy společnosti zdroje: krátké jméno nebo DNS jméno. Jen jednoznačná shoda –
 * víc kandidátů = počítač zůstane bez aktiva (správce spáruje ručně). Údaje aktiva se nepřepisují, jen se doplní
 * prázdné (FQDN, systém) a zapíše zdroj „Active Directory“.
 */
export async function linkComputers(db: Db, row: Row, now = new Date()): Promise<number> {
  const open = await db
    .select({ id: identityComputers.id, name: identityComputers.name, dnsName: identityComputers.dnsName, externalId: identityComputers.externalId, os: identityComputers.os, osVersion: identityComputers.osVersion })
    .from(identityComputers)
    .where(and(eq(identityComputers.sourceId, row.id), isNull(identityComputers.assetId), isNull(identityComputers.removedAt)));
  let linked = 0;
  for (const c of open) {
    const host = shortName(c.name);
    const cand = await db
      .select({ id: assets.id, fqdn: assets.fqdn, osName: assets.osName, osVersion: assets.osVersion })
      .from(assets)
      .where(
        and(
          eq(assets.companyId, row.companyId),
          inArray(assets.lifecycleStatus, ["planned", "active", "maintenance"]),
          or(
            sql`split_part(lower(${assets.hostname}), '.', 1) = ${host}`,
            sql`lower(${assets.name}) = ${c.name.toLowerCase()}`,
            c.dnsName ? sql`lower(${assets.fqdn}) = ${c.dnsName}` : undefined,
          ),
        ),
      )
      .limit(3);
    if (cand.length !== 1) continue;
    await attachComputer(db, c, cand[0]!, now);
    linked++;
  }
  return linked;
}

/** Vazba počítač → aktivum: zdroj „Active Directory“ a doplnění prázdných údajů. */
export async function attachComputer(
  db: Db,
  c: { id: string; externalId: string; dnsName: string | null; os: string | null; osVersion: string | null },
  a: { id: string; fqdn: string | null; osName: string | null; osVersion: string | null },
  now = new Date(),
) {
  await db.update(identityComputers).set({ assetId: a.id }).where(eq(identityComputers.id, c.id));
  const fill: Partial<typeof assets.$inferInsert> = {};
  if (!a.fqdn && c.dnsName) fill.fqdn = c.dnsName;
  if (!a.osName && c.os) {
    fill.osName = c.os;
    if (!a.osVersion && c.osVersion) fill.osVersion = c.osVersion;
  }
  if (Object.keys(fill).length) await db.update(assets).set(fill).where(eq(assets.id, a.id));
  await db
    .insert(assetSources)
    .values({ assetId: a.id, sourceType: "ad", sourceRef: c.externalId, connectionId: null, lastSyncedAt: now })
    .onConflictDoUpdate({ target: [assetSources.sourceType, assetSources.sourceRef, assetSources.connectionId], set: { assetId: a.id, lastSyncedAt: now } });
}

/** Nálezy počítačů: z adresáře (pravidla v shared) + server bez sběru dat (přes spárované aktivum). */
export async function computerFindings(db: Db, row: Row, list: DirComputer[], ids: Map<string, string>, policy: IdentityPolicy, now: Date): Promise<ComputerFindingRow[]> {
  const out: ComputerFindingRow[] = [];
  for (const d of evaluateComputers(list, policy, now)) {
    const id = d.computer ? (ids.get(d.computer) ?? null) : null;
    if (d.computer && !id) continue;
    out.push({ accountId: null, computerId: id, subject: id ? `computer:${id}` : "laps", rule: d.rule, severity: d.severity, detail: d.detail.slice(0, 2000) });
  }
  // aktivní servery a řadiče domény bez agenta, sběrače i Wazuhu
  const staleBefore = new Date(now.getTime() - (policy.computerStaleDays ?? 90) * 86_400_000);
  const servers = await db
    .select({ id: identityComputers.id, name: identityComputers.name, assetId: identityComputers.assetId, role: identityComputers.role })
    .from(identityComputers)
    .where(
      and(
        eq(identityComputers.sourceId, row.id),
        isNull(identityComputers.removedAt),
        eq(identityComputers.enabled, true),
        inArray(identityComputers.role, ["server", "dc"]),
        gte(identityComputers.lastLogonAt, staleBefore),
      ),
    );
  const mon = await monitoringOf(
    db,
    servers.map((s) => s.assetId).filter((x): x is string => !!x),
  );
  for (const s of servers) {
    if (s.assetId && mon.get(s.assetId)?.size) continue;
    out.push({
      accountId: null,
      computerId: s.id,
      subject: `computer:${s.id}`,
      rule: "server_unmonitored",
      severity: s.role === "dc" ? "high" : "medium",
      detail: s.assetId ? `${s.name}: aktivum bez agenta CONTIX, sběrače i Wazuhu` : `${s.name}: server není v aktivech CONTIXu a nemá sběr dat`,
    });
  }
  return out;
}

export const isComputerRule = (rule: string) => (COMPUTER_RULES as string[]).includes(rule);

/** Založení aktiv z počítačů bez aktiva (v1.90): server/řadič → server, ostatní → stanice; nejdřív zkusí párování. */
export async function createComputerAssets(db: Db, rows: { id: string; companyId: string; name: string; dnsName: string | null; externalId: string; os: string | null; osVersion: string | null; role: string }[]) {
  let created = 0;
  let linked = 0;
  for (const c of rows) {
    const host = shortName(c.name);
    const cand = await db
      .select({ id: assets.id, fqdn: assets.fqdn, osName: assets.osName, osVersion: assets.osVersion })
      .from(assets)
      .where(and(eq(assets.companyId, c.companyId), or(sql`split_part(lower(${assets.hostname}), '.', 1) = ${host}`, c.dnsName ? sql`lower(${assets.fqdn}) = ${c.dnsName}` : undefined)))
      .limit(2);
    if (cand.length === 1) {
      await attachComputer(db, c, cand[0]!);
      linked++;
      continue;
    }
    const assetType = c.role === "server" || c.role === "dc" ? ("server" as const) : ("workstation" as const);
    const now = new Date();
    const [a] = await db
      .insert(assets)
      .values({
        companyId: c.companyId,
        name: c.name,
        assetType,
        assetClass: defaultAssetClass(assetType),
        hostname: host,
        fqdn: c.dnsName,
        osName: c.os,
        osVersion: c.osVersion,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .returning({ id: assets.id, fqdn: assets.fqdn, osName: assets.osName, osVersion: assets.osVersion });
    await attachComputer(db, c, a!, now);
    created++;
  }
  return { created, linked };
}
