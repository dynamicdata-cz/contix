import {
  AdSourceConfig,
  DEFAULT_IDENTITY_POLICY,
  DEFAULT_PROVISIONING,
  ProvisioningConfig,
  EntraSourceConfig,
  IDENTITY_SEVERITIES,
  IdentityPolicySchema,
  evaluateAccount,
  evaluateGroups,
  type DirAccount,
  type IdentitySeverity,
  type IdentitySourceDto,
  type IdentitySourceStats,
  type ProvisioningResultDto,
} from "@contix/shared";
import { and, count, eq, isNull, lt, ne, sql } from "drizzle-orm";
import { decrypt } from "../../auth/crypto";
import { getSettings } from "../../auth/service";
import { appSecret, type Config } from "../../config";
import type { Db } from "../../db/client";
import { identityAccounts, identityFindings, identitySnapshots, identitySources, users } from "../../db/schema";
import { fetchAd } from "./ad";
import { fetchEntra } from "./entra";
import { evaluateSod } from "./sod";
import { applyProvisioning, provisioningOf } from "./provisioning";
import { processAutomations } from "./automations";

/* ============================================================
 * Synchronizace adresáře → účty → nálezy (ADR-029).
 * Nálezy se párují podle (zdroj, pravidlo, předmět): co zmizí, je „vyřešené“; výjimka po termínu se znovu otevře.
 * ============================================================ */

export type SourceRow = typeof identitySources.$inferSelect;

export function sourceSecret(row: Pick<SourceRow, "secretEnc">, config: Config): string | null {
  if (!row.secretEnc) return null;
  try {
    return decrypt(row.secretEnc, appSecret(config));
  } catch {
    return null; // změněný APP_SECRET → tajemství je potřeba zadat znovu
  }
}

export function sourceDto(r: SourceRow): IdentitySourceDto {
  return {
    id: r.id,
    companyId: r.companyId,
    kind: r.kind,
    name: r.name,
    enabled: r.enabled,
    syncHours: r.syncHours,
    policy: IdentityPolicySchema.parse(r.policy ?? {}),
    provisioning: ProvisioningConfig.parse(r.provisioning ?? DEFAULT_PROVISIONING),
    config: (r.kind === "ad" ? AdSourceConfig : EntraSourceConfig).parse(r.config) as IdentitySourceDto["config"],
    hasSecret: !!r.secretEnc,
    lastSyncAt: r.lastSyncAt?.toISOString() ?? null,
    lastStatus: (r.lastStatus as IdentitySourceDto["lastStatus"]) ?? null,
    lastError: r.lastError,
    notes: r.notes ?? [],
    stats: r.stats ?? null,
  };
}

/** Načte účty z adresáře (bez zápisu). */
export async function fetchDirectory(row: Pick<SourceRow, "kind" | "config" | "provisioning">, secret: string, config: Config) {
  if (row.kind === "ad") return fetchAd({ config: AdSourceConfig.parse(row.config), password: secret });
  const cfg = EntraSourceConfig.parse(row.config);
  const prov = ProvisioningConfig.parse(row.provisioning ?? DEFAULT_PROVISIONING);
  const groups = [...new Set([...cfg.trackedGroups, ...(prov.enabled && prov.group ? [prov.group] : [])])];
  return fetchEntra({ config: cfg, secret, env: config }, groups);
}

const running = new Set<string>();
export const isSyncRunning = (id: string) => running.has(id);

export interface SyncResult {
  provisioning?: ProvisioningResultDto;
  accounts: number;
  removed: number;
  findings: { opened: number; resolved: number; open: number };
  stats: IdentitySourceStats;
  notes: string[];
}

/**
 * Synchronizace jednoho zdroje. `fetcher` lze v testech nahradit.
 * Chyba se zapíše ke zdroji (lastStatus = error) a vyhodí dál.
 */
export async function syncSource(db: Db, config: Config, sourceId: string, opts: { now?: Date } = {}): Promise<SyncResult> {
  if (running.has(sourceId)) throw new Error("Synchronizace tohoto zdroje už probíhá.");
  running.add(sourceId);
  const now = opts.now ?? new Date();
  try {
    const [row] = await db.select().from(identitySources).where(eq(identitySources.id, sourceId));
    if (!row) throw new Error("Zdroj nenalezen");
    const secret = sourceSecret(row, config);
    if (!secret) throw new Error(row.kind === "ad" ? "Chybí heslo účtu pro čtení – zadejte ho v nastavení zdroje." : "Chybí tajný klíč aplikace – zadejte ho v nastavení zdroje.");
    await db.update(identitySources).set({ lastStatus: "running", updatedAt: now }).where(eq(identitySources.id, sourceId));
    try {
      const dir = await fetchDirectory(row, secret, config);
      // ochrana: prázdná odpověď (chybná Base DN, filtr, oprávnění) nesmí „vyřešit“ všechny nálezy a označit účty za odstraněné
      if (!dir.accounts.length) {
        const [cnt] = await db.select({ n: count() }).from(identityAccounts).where(and(eq(identityAccounts.sourceId, row.id), isNull(identityAccounts.removedAt)));
        if ((cnt?.n ?? 0) > 0) throw new Error("Adresář nevrátil žádné účty – zkontrolujte Base DN a oprávnění účtu. Dosavadní účty a nálezy zůstaly beze změny.");
      }
      const result = await applyDirectory(db, row, dir.accounts, dir.notes, now);
      // synchronizace uživatelů a struktury (je-li zapnutá)
      if (provisioningOf(row).enabled) result.provisioning = await applyProvisioning(db, row);
      return result;
    } catch (e) {
      await db
        .update(identitySources)
        .set({ lastStatus: "error", lastError: (e as Error).message.slice(0, 2000), lastSyncAt: now, updatedAt: new Date() })
        .where(eq(identitySources.id, sourceId));
      throw e;
    }
  } finally {
    running.delete(sourceId);
  }
}

/** Zápis účtů a nálezů pro načtený adresář. */
export async function applyDirectory(db: Db, row: SourceRow, accounts: DirAccount[], notes: string[], now = new Date()): Promise<SyncResult> {
  const policy = IdentityPolicySchema.parse(row.policy ?? DEFAULT_IDENTITY_POLICY);
  // spárování s uživateli CONTIXu podle e-mailu
  const people = await db.select({ id: users.id, email: users.email, isActive: users.isActive }).from(users);
  const byEmail = new Map(people.map((p) => [p.email.toLowerCase(), p]));

  // duplicitní externalId (nemělo by nastat) – poslední vyhrává
  const unique = [...new Map(accounts.map((a) => [a.externalId, a])).values()];
  const ids = new Map<string, string>();
  for (let i = 0; i < unique.length; i += 500) {
    const part = unique.slice(i, i + 500);
    const rows = await db
      .insert(identityAccounts)
      .values(
        part.map((a) => ({
          sourceId: row.id,
          companyId: row.companyId,
          externalId: a.externalId,
          login: a.login.slice(0, 300),
          displayName: a.displayName.slice(0, 300),
          email: a.email?.slice(0, 320) ?? null,
          kind: a.kind,
          enabled: a.enabled,
          privileged: a.privilegedVia.length > 0,
          privilegedVia: a.privilegedVia,
          groups: a.groups,
          flags: a.flags,
          mfa: a.mfa,
          dn: a.dn,
          dirCreatedAt: a.createdAt,
          lastLogonAt: a.lastLogonAt,
          pwdLastSetAt: a.pwdLastSetAt,
          department: a.department?.slice(0, 300) ?? null,
          title: a.title?.slice(0, 300) ?? null,
          userId: (a.email && byEmail.get(a.email)?.id) || null,
          firstSeenAt: now,
          lastSeenAt: now,
          removedAt: null,
        })),
      )
      .onConflictDoUpdate({
        target: [identityAccounts.sourceId, identityAccounts.externalId],
        set: {
          companyId: row.companyId,
          login: sql`excluded.login`,
          displayName: sql`excluded.display_name`,
          email: sql`excluded.email`,
          kind: sql`excluded.kind`,
          enabled: sql`excluded.enabled`,
          privileged: sql`excluded.privileged`,
          privilegedVia: sql`excluded.privileged_via`,
          groups: sql`excluded.groups`,
          flags: sql`excluded.flags`,
          mfa: sql`excluded.mfa`,
          dn: sql`excluded.dn`,
          dirCreatedAt: sql`excluded.dir_created_at`,
          lastLogonAt: sql`excluded.last_logon_at`,
          pwdLastSetAt: sql`excluded.pwd_last_set_at`,
          department: sql`excluded.department`,
          title: sql`excluded.title`,
          userId: sql`excluded.user_id`,
          lastSeenAt: now,
          removedAt: null,
        },
      })
      .returning({ id: identityAccounts.id, externalId: identityAccounts.externalId });
    for (const r of rows) ids.set(r.externalId, r.id);
  }
  // účty, které z adresáře zmizely
  const removed = await db
    .update(identityAccounts)
    .set({ removedAt: now })
    .where(and(eq(identityAccounts.sourceId, row.id), lt(identityAccounts.lastSeenAt, now), isNull(identityAccounts.removedAt)))
    .returning({ id: identityAccounts.id });

  // nálezy
  const desired: { accountId: string | null; subject: string; rule: string; severity: IdentitySeverity; detail: string }[] = [];
  for (const a of unique) {
    const id = ids.get(a.externalId)!;
    const person = a.email ? byEmail.get(a.email) : undefined;
    for (const f of evaluateAccount(a, policy, now, { contixInactive: !!person && !person.isActive }))
      desired.push({ accountId: id, subject: id, rule: f.rule, severity: f.severity, detail: f.detail });
  }
  for (const g of evaluateGroups(unique, policy)) desired.push({ accountId: null, subject: g.subject.slice(0, 400), rule: g.draft.rule, severity: g.draft.severity, detail: g.draft.detail });

  const before = new Set(
    (await db.select({ rule: identityFindings.rule, subject: identityFindings.subject }).from(identityFindings).where(and(eq(identityFindings.sourceId, row.id), ne(identityFindings.status, "resolved")))).map(
      (f) => `${f.rule}|${f.subject}`,
    ),
  );
  for (let i = 0; i < desired.length; i += 500) {
    const part = desired.slice(i, i + 500);
    await db
      .insert(identityFindings)
      .values(part.map((f) => ({ sourceId: row.id, companyId: row.companyId, ...f, status: "open" as const, firstSeenAt: now, lastSeenAt: now })))
      .onConflictDoUpdate({
        target: [identityFindings.sourceId, identityFindings.rule, identityFindings.subject],
        set: {
          companyId: row.companyId,
          accountId: sql`excluded.account_id`,
          severity: sql`excluded.severity`,
          detail: sql`excluded.detail`,
          lastSeenAt: now,
          resolvedAt: null,
          // vyřešený nález se vrátil, nebo výjimka vypršela → znovu otevřený
          status: sql`case when ${identityFindings.status} = 'resolved' then 'open'::identity_finding_status
            when ${identityFindings.status} = 'accepted' and ${identityFindings.acceptedUntil} < ${now.toISOString().slice(0, 10)}::date then 'open'::identity_finding_status
            else ${identityFindings.status} end`,
        },
      });
  }
  const resolved = await db
    .update(identityFindings)
    .set({ status: "resolved", resolvedAt: now })
    .where(and(eq(identityFindings.sourceId, row.id), lt(identityFindings.lastSeenAt, now), ne(identityFindings.status, "resolved")))
    .returning({ id: identityFindings.id });
  const opened = desired.filter((f) => !before.has(`${f.rule}|${f.subject}`)).length;

  const stats = await sourceStats(db, row.id);
  await db.insert(identitySnapshots).values({ sourceId: row.id, companyId: row.companyId, at: now, stats });
  await db
    .update(identitySources)
    .set({ lastSyncAt: now, lastStatus: "ok", lastError: null, notes, stats, updatedAt: new Date() })
    .where(eq(identitySources.id, row.id));
  // toxické kombinace dané společnosti (skupiny se mohly změnit)
  await evaluateSod(db, { companyId: row.companyId, now });
  return { accounts: unique.length, removed: removed.length, findings: { opened, resolved: resolved.length, open: desired.length }, stats, notes };
}

export async function sourceStats(db: Db, sourceId: string): Promise<IdentitySourceStats> {
  const live = and(eq(identityAccounts.sourceId, sourceId), isNull(identityAccounts.removedAt));
  const [[acc], bySev] = await Promise.all([
    db
      .select({
        accounts: count(),
        enabled: sql<number>`count(*) filter (where ${identityAccounts.enabled})`.mapWith(Number),
        privileged: sql<number>`count(*) filter (where ${identityAccounts.enabled} and ${identityAccounts.privileged})`.mapWith(Number),
      })
      .from(identityAccounts)
      .where(live),
    db
      .select({ s: identityFindings.severity, n: count() })
      .from(identityFindings)
      .where(and(eq(identityFindings.sourceId, sourceId), eq(identityFindings.status, "open")))
      .groupBy(identityFindings.severity),
  ]);
  const findings = Object.fromEntries(IDENTITY_SEVERITIES.map((s) => [s, 0])) as Record<IdentitySeverity, number>;
  for (const r of bySev) findings[r.s] = r.n;
  return { accounts: acc?.accounts ?? 0, enabled: acc?.enabled ?? 0, privileged: acc?.privileged ?? 0, findings };
}

/** Plánovač: zdroje, kterým uplynul interval synchronizace. Chyba jednoho zdroje nezastaví ostatní. */
export async function processIdentitySync(db: Db, config: Config, now = new Date()): Promise<string[]> {
  if (!((await getSettings(db)).enabledModules as string[]).includes("identity")) return [];
  const rows = await db.select().from(identitySources).where(eq(identitySources.enabled, true));
  const errors: string[] = [];
  for (const r of rows) {
    if (r.syncHours <= 0 || running.has(r.id)) continue;
    if (r.lastSyncAt && now.getTime() - r.lastSyncAt.getTime() < r.syncHours * 3_600_000) continue;
    await syncSource(db, config, r.id, { now }).catch((e) => errors.push(`${r.name}: ${(e as Error).message}`));
  }
  // obsazení funkčních míst se mění i bez synchronizace adresáře
  await evaluateSod(db).catch((e) => errors.push(`Toxické kombinace: ${(e as Error).message}`));
  // automatické testy opatření (kontrola účtů), kterým uplynul interval
  for (const e of await processAutomations(db, now).catch((e) => [(e as Error).message])) errors.push(`Automatický test: ${e}`);
  return errors;
}
