import { evaluateSodRule, type SodAccount, type SodHolder } from "@contix/shared";
import { and, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { identityAccounts, identitySources, positionHolders, positions, sodRules, sodViolations, users } from "../../db/schema";

/* ============================================================
 * Toxické kombinace (SoD) – vyhodnocení pravidel nad účty (skupiny AD / role Entra) a funkčními místy.
 * Porušení mají stejný životní cyklus jako nálezy: zmizí → vyřešené, výjimka s termínem, po termínu znovu otevřené.
 * ============================================================ */

export async function evaluateSod(db: Db, opts: { companyId?: string; ruleId?: string; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const rules = await db
    .select()
    .from(sodRules)
    .where(and(opts.companyId ? eq(sodRules.companyId, opts.companyId) : undefined, opts.ruleId ? eq(sodRules.id, opts.ruleId) : undefined));
  if (!rules.length) return { opened: 0, resolved: 0, open: 0 };

  // vstupy po společnostech (jedno načtení na společnost)
  const cache = new Map<string, SodAccount[]>();
  const accountsOf = async (companyId: string) => {
    if (!cache.has(companyId)) {
      const rows = await db
        .select({ id: identityAccounts.id, userId: identityAccounts.userId, login: identityAccounts.login, displayName: identityAccounts.displayName, groups: identityAccounts.groups, sourceName: identitySources.name })
        .from(identityAccounts)
        .innerJoin(identitySources, eq(identitySources.id, identityAccounts.sourceId))
        .where(and(eq(identityAccounts.companyId, companyId), isNull(identityAccounts.removedAt), eq(identityAccounts.enabled, true)));
      cache.set(companyId, rows);
    }
    return cache.get(companyId)!;
  };
  const posIds = [...new Set(rules.flatMap((r) => [...r.sideA.positionIds, ...r.sideB.positionIds]))];
  const holders: SodHolder[] = posIds.length
    ? await db
        .select({ userId: users.id, userName: users.displayName, positionId: positions.id, positionName: positions.name })
        .from(positionHolders)
        .innerJoin(users, eq(users.id, positionHolders.userId))
        .innerJoin(positions, eq(positions.id, positionHolders.positionId))
        .where(and(inArray(positionHolders.positionId, posIds), eq(users.isActive, true)))
    : [];

  let opened = 0;
  let resolved = 0;
  let open = 0;
  for (const rule of rules) {
    const hits = rule.enabled ? evaluateSodRule(rule, await accountsOf(rule.companyId), holders) : [];
    const before = new Set(
      (await db.select({ s: sodViolations.subject }).from(sodViolations).where(and(eq(sodViolations.ruleId, rule.id), ne(sodViolations.status, "resolved")))).map((x) => x.s),
    );
    if (hits.length)
      await db
        .insert(sodViolations)
        .values(hits.map((h) => ({ ruleId: rule.id, companyId: rule.companyId, subject: h.subject, userId: h.userId, person: h.person.slice(0, 300), accountIds: h.accountIds, matchA: h.matchA, matchB: h.matchB, firstSeenAt: now, lastSeenAt: now })))
        .onConflictDoUpdate({
          target: [sodViolations.ruleId, sodViolations.subject],
          set: {
            companyId: rule.companyId,
            userId: sql`excluded.user_id`,
            person: sql`excluded.person`,
            accountIds: sql`excluded.account_ids`,
            matchA: sql`excluded.match_a`,
            matchB: sql`excluded.match_b`,
            lastSeenAt: now,
            resolvedAt: null,
            status: sql`case when ${sodViolations.status} = 'resolved' then 'open'::identity_finding_status
              when ${sodViolations.status} = 'accepted' and ${sodViolations.acceptedUntil} < ${now.toISOString().slice(0, 10)}::date then 'open'::identity_finding_status
              else ${sodViolations.status} end`,
          },
        });
    const r = await db
      .update(sodViolations)
      .set({ status: "resolved", resolvedAt: now })
      .where(and(eq(sodViolations.ruleId, rule.id), lt(sodViolations.lastSeenAt, now), ne(sodViolations.status, "resolved")))
      .returning({ id: sodViolations.id });
    opened += hits.filter((h) => !before.has(h.subject)).length;
    resolved += r.length;
    open += hits.length;
  }
  return { opened, resolved, open };
}
