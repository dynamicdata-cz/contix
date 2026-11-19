import { IDENTITY_FINDING_STATUSES, IDENTITY_RULES, IDENTITY_SEVERITIES } from "@contix/shared";
import { eq, ilike, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { identityAccounts, identityFindings } from "../../db/schema";

/* Filtr nálezů identit – seznam, počty, exporty, reporty (v1.89, ADR-184). */

const likeEsc = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export const FindingQuery = z.object({
  status: z.enum(IDENTITY_FINDING_STATUSES).optional(),
  severity: z.enum(IDENTITY_SEVERITIES).optional(),
  rule: z.enum(IDENTITY_RULES).optional(),
  sourceId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  q: z.string().trim().max(200).optional(),
});
export type IdentityFindingQuery = z.infer<typeof FindingQuery>;
/** Podmínky nálezů podle filtru (v1.89): `omit` vynechá dimenzi – počty u voleb filtru. */
export function findingWhere(q: IdentityFindingQuery, omit?: "rule" | "severity"): SQL[] {
  const where: SQL[] = [eq(identityFindings.status, q.status ?? "open")];
  if (q.severity && omit !== "severity") where.push(eq(identityFindings.severity, q.severity));
  if (q.rule && omit !== "rule") where.push(eq(identityFindings.rule, q.rule));
  if (q.sourceId) where.push(eq(identityFindings.sourceId, q.sourceId));
  if (q.accountId) where.push(eq(identityFindings.accountId, q.accountId));
  if (q.q) {
    const like = `%${likeEsc(q.q)}%`;
    where.push(or(ilike(identityAccounts.login, like), ilike(identityAccounts.displayName, like), ilike(identityFindings.detail, like))!);
  }
  return where;
}

