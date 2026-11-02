import { EXCEPTION_LABELS, exceptionState, FRAMEWORKS, IDENTITY_RULE_INFO, requirementById, sortExceptions, type ExceptionDto, type ExceptionKind, type IdentityRule } from "@contix/shared";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../../db/client";
import { alertSuggestions, controls, exceptionControls, socSuppressions, assets, assetVulnerabilities, identityAccounts, identityFindings, positions, requirementAssessments, risks, sodRules, sodViolations, users } from "../../db/schema";

/* ============================================================
 * Výjimky a přijatá rizika (ADR-039): sběr z modulů, nic se nepersistuje.
 * Každý druh se načítá jen pro společnosti, kde má uživatel oprávnění ke čtení dané evidence (a modul je zapnutý).
 * ============================================================ */

export type ExceptionScope = Partial<Record<ExceptionKind, string[]>>;

const accepter = alias(users, "exc_accepter");
const fwShort = (id: string) => FRAMEWORKS.find((f) => f.id === id.split(":")[0])?.shortName ?? id.split(":")[0]!;

export async function loadExceptions(db: Db, scope: ExceptionScope, today = new Date().toISOString().slice(0, 10), canWrite?: (kind: ExceptionKind, companyId: string) => boolean): Promise<ExceptionDto[]> {
  const out: ExceptionDto[] = [];
  const has = (k: ExceptionKind) => (scope[k]?.length ?? 0) > 0;
  const mk = (x: Omit<ExceptionDto, "key" | "state" | "compensating" | "compensatingNote" | "canEdit">): ExceptionDto => ({
    ...x,
    key: `${x.kind}:${x.id}`,
    state: exceptionState(x.until, today),
    compensating: [],
    compensatingNote: null,
    canEdit: canWrite?.(x.kind, x.companyId) ?? false,
  });

  const jobs: Promise<void>[] = [];
  if (has("identity_finding"))
    jobs.push(
      db
        .select({ f: identityFindings, account: identityAccounts.displayName, by: accepter.displayName })
        .from(identityFindings)
        .leftJoin(identityAccounts, eq(identityAccounts.id, identityFindings.accountId))
        .leftJoin(accepter, eq(accepter.id, identityFindings.acceptedBy))
        .where(and(eq(identityFindings.status, "accepted"), inArray(identityFindings.companyId, scope.identity_finding!)))
        .then((rows) => {
          for (const r of rows)
            out.push(
              mk({
                kind: "identity_finding",
                id: r.f.id,
                companyId: r.f.companyId,
                title: `${IDENTITY_RULE_INFO[r.f.rule as IdentityRule]?.title ?? r.f.rule}: ${r.account || r.f.subject.replace(/^group:/, "")}`,
                detail: r.f.detail || null,
                severity: r.f.severity,
                reason: r.f.acceptedReason,
                acceptedByName: r.by,
                acceptedById: r.f.acceptedBy,
                until: r.f.acceptedUntil,
                link: "/identity?tab=findings&status=accepted",
              }),
            );
        }),
    );
  if (has("sod_violation"))
    jobs.push(
      db
        .select({ v: sodViolations, rule: sodRules.name, severity: sodRules.severity, by: accepter.displayName })
        .from(sodViolations)
        .innerJoin(sodRules, eq(sodRules.id, sodViolations.ruleId))
        .leftJoin(accepter, eq(accepter.id, sodViolations.acceptedBy))
        .where(and(eq(sodViolations.status, "accepted"), inArray(sodViolations.companyId, scope.sod_violation!)))
        .then((rows) => {
          for (const r of rows)
            out.push(
              mk({
                kind: "sod_violation",
                id: r.v.id,
                companyId: r.v.companyId,
                title: `${r.rule}: ${r.v.person || r.v.subject}`,
                detail: [r.v.matchA.join(", "), r.v.matchB.join(", ")].filter(Boolean).join(" × ") || null,
                severity: r.severity,
                reason: r.v.acceptedReason,
                acceptedByName: r.by,
                acceptedById: r.v.acceptedBy,
                until: r.v.acceptedUntil,
                link: "/identity?tab=sod&status=accepted",
              }),
            );
        }),
    );
  if (has("vulnerability"))
    jobs.push(
      db
        .select({ v: assetVulnerabilities, asset: assets.name, companyId: assets.companyId, by: accepter.displayName })
        .from(assetVulnerabilities)
        .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
        .leftJoin(accepter, eq(accepter.id, assetVulnerabilities.acceptedBy))
        .where(and(eq(assetVulnerabilities.status, "accepted"), inArray(assets.companyId, scope.vulnerability!)))
        .then((rows) => {
          for (const r of rows)
            out.push(
              mk({
                kind: "vulnerability",
                id: r.v.id,
                companyId: r.companyId,
                title: `${r.v.cveId} – ${r.asset}`,
                detail: [r.v.packageName, r.v.packageVersion].filter(Boolean).join(" ") || null,
                severity: r.v.severity,
                reason: r.v.acceptedReason,
                acceptedByName: r.by,
                acceptedById: r.v.acceptedBy,
                until: r.v.acceptedUntil,
                link: `/assets/${r.v.assetId}`,
              }),
            );
        }),
    );
  if (has("risk_accepted"))
    jobs.push(
      db
        .select({ r: risks, owner: positions.name })
        .from(risks)
        .leftJoin(positions, eq(positions.id, risks.ownerPositionId))
        .where(and(or(eq(risks.status, "accepted"), eq(risks.treatment, "accept")), inArray(risks.companyId, scope.risk_accepted!)))
        .then((rows) => {
          for (const { r, owner } of rows) {
            if (r.status === "closed") continue;
            out.push(
              mk({
                kind: "risk_accepted",
                id: r.id,
                companyId: r.companyId,
                title: `${r.code ? `${r.code} ` : ""}${r.name}`,
                detail: owner ? `Vlastník rizika: ${owner}` : null,
                severity: null,
                reason: r.treatmentPlan,
                acceptedByName: owner,
                acceptedById: null,
                until: null,
                link: `/risks/${r.id}`,
              }),
            );
          }
        }),
    );
  if (has("requirement_na"))
    jobs.push(
      db
        .select({ a: requirementAssessments, by: accepter.displayName })
        .from(requirementAssessments)
        .leftJoin(accepter, eq(accepter.id, requirementAssessments.updatedById))
        .where(and(eq(requirementAssessments.applicable, false), inArray(requirementAssessments.companyId, scope.requirement_na!)))
        .then((rows) => {
          for (const { a, by } of rows) {
            const q = requirementById(a.requirementId);
            if (!q) continue;
            out.push(
              mk({
                kind: "requirement_na",
                id: `${a.companyId}:${a.requirementId}`,
                companyId: a.companyId,
                title: `${fwShort(q.id)} ${q.ref}`,
                detail: a.compensating ? `Kompenzační opatření: ${a.compensating}` : q.text.slice(0, 200),
                severity: null,
                reason: a.justification,
                acceptedByName: by,
                acceptedById: a.updatedById,
                until: null,
                link: `/controls/soa?framework=${q.framework}`,
              }),
            );
          }
        }),
    );
  if (has("soc_suppression"))
    jobs.push(
      (async () => {
        const rows = await db
          .select({ s: socSuppressions, by: accepter.displayName })
          .from(socSuppressions)
          .leftJoin(accepter, eq(accepter.id, socSuppressions.createdById))
          .where(and(isNull(socSuppressions.revokedAt), inArray(socSuppressions.companyId, scope.soc_suppression!)));
        const rules = [...new Set(rows.map((r) => r.s.ruleId))];
        const desc_ = rules.length
          ? await db
              .selectDistinctOn([alertSuggestions.ruleId], { ruleId: alertSuggestions.ruleId, d: alertSuggestions.description })
              .from(alertSuggestions)
              .where(inArray(alertSuggestions.ruleId, rules))
              .orderBy(alertSuggestions.ruleId, desc(alertSuggestions.lastSeen))
          : [];
        const dmap = new Map(desc_.map((x) => [x.ruleId, x.d]));
        for (const { s, by } of rows)
          out.push(
            mk({
              kind: "soc_suppression",
              id: s.id,
              companyId: s.companyId,
              title: `Wazuh ${s.ruleId}${dmap.get(s.ruleId) ? `: ${dmap.get(s.ruleId)}` : ""}`,
              detail: [s.agentId ? `agent ${s.agentId}` : null, s.srcip ? `IP ${s.srcip}` : null, `zásahů ${s.hits}`].filter(Boolean).join(" · "),
              severity: null,
              reason: s.reason,
              acceptedByName: by,
              acceptedById: s.createdById,
              until: s.until,
              link: "/soc?tab=suppressions",
            }),
          );
      })(),
    );
  await Promise.all(jobs);
  // kompenzační opatření (v1.11, ADR-107)
  if (out.length) {
    const comp = await db
      .select({ kind: exceptionControls.kind, recordId: exceptionControls.recordId, note: exceptionControls.note, id: controls.id, code: controls.code, name: controls.name, status: controls.status })
      .from(exceptionControls)
      .innerJoin(controls, eq(controls.id, exceptionControls.controlId))
      .where(inArray(exceptionControls.companyId, [...new Set(out.map((e) => e.companyId))]));
    const by = new Map<string, typeof comp>();
    for (const r of comp) by.set(`${r.kind}:${r.recordId}`, [...(by.get(`${r.kind}:${r.recordId}`) ?? []), r]);
    for (const e of out) {
      const rs = by.get(e.key);
      if (!rs) continue;
      e.compensating = rs.map(({ id, code, name, status }) => ({ id, code, name, status })).sort((a, b) => (a.code ?? a.name).localeCompare(b.code ?? b.name, "cs"));
      e.compensatingNote = rs.find((r) => r.note)?.note ?? null;
    }
  }
  return sortExceptions(out);
}

export const exceptionKindLabel = (k: ExceptionKind) => EXCEPTION_LABELS.kind[k];
