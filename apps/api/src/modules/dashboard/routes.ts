import { dpiaRequired, type DashboardDto, type ObligationKind } from "@contix/shared";
import { and, count, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { hasPerm, requirePerm } from "../../auth/middleware";
import { inScope, scopeOf } from "../../auth/scope";
import { getSettings, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import {
  aiSuggestions,
  auditFindings,
  audits,
  biaAssessments,
  changes,
  continuityPlans,
  dpias,
  processingActivities,
  incidents,
  policies,
  processes,
  suppliers,
  trainingCourses,
  identityAccounts,
  identityFindings,
  identitySources,
} from "../../db/schema";
import { getNotificationSettings } from "../notifications/service";
import { tFor } from "../i18n/service";
import {
  collectObligations,
  kindsForModules,
} from "../notifications/obligations";

/* ============================================================
 * Úvodní přehled – počty za všechny oblasti v aktuálním rozsahu + nejbližší povinnosti týmu.
 * Detailní souhrny (rizika, aktiva, zranitelnosti, shoda) si stránka bere z existujících endpointů.
 * ============================================================ */

/** Oprávnění ke čtení podle druhu povinnosti (stejně jako /notifications/team). */
const NEED: Record<ObligationKind, string> = {
  soc_sla: "soc:read",
  vuln_remediation: "assets:read",
  info_assessment: "legislation:read",
  incident_report: "incidents:read",
  risk_action: "risks:read",
  risk_review: "risks:read",
  risk_trigger: "risks:read",
  exercise: "bia:read",
  cert_expiry: "assets:read",
  audit_request: "audits:read",
  finding: "audits:read",
  audit: "audits:read",
  isms_review: "isms:read",
  change: "isms:read",
  policy_review: "policies:read",
  policy_ack: "policies:read",
  training: "awareness:read",
  plan_test: "bia:read",
  contract: "suppliers:read",
  assessment_cycle: "risks:read",
  control_test: "controls:read",
  evidence_expiry: "controls:read",
  processing_review: "gdpr:read",
  ai_review: "aiact:read",
  cra_report: "cra:read",
  cra_support: "cra:read",
  doc_approval: "policies:read",
  doc_retention: "policies:write",
  access_review: "identity:read",
  legal_review: "legislation:read",
  legal_task: "legislation:read",
  exception_expiry: "assets:read",
  supplier_questionnaire: "suppliers:read",
  supplier_report: "suppliers:read",
  task: "actions:read",
};

export function dashboardRoutes(db: Db) {
  return new Hono<AppEnv>().get(
    "/",
    requirePerm(
      "obligations:self",
      "assets:read",
      "risks:read",
      "controls:read",
      "isms:read",
      "incidents:read",
      "audits:read",
      "policies:read",
      "identity:read",
    ),
    async (c) => {
      const [base, notif, t] = await Promise.all([
        getSettings(db),
        getNotificationSettings(db),
        tFor(db, c),
      ]);
      const mod = (m: string) => (base.enabledModules as string[]).includes(m);
      const can = (p: string) => hasPerm(c, p as never);
      const today = new Date().toISOString().slice(0, 10);
      const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;

      const out: DashboardDto = {
        processes: null,
        incidents: null,
        audits: null,
        policies: null,
        awareness: null,
        suppliers: null,
        isms: null,
        continuity: null,
        ai: null,
        gdpr: null,
        identity: null,
        obligations: null,
      };

      const jobs: Promise<void>[] = [];
      if (mod("processes") && can("processes:read"))
        jobs.push(
          (async () => {
            const [total, noOwner] = await Promise.all([
              n(
                db
                  .select({ n: count() })
                  .from(processes)
                  .where(inScope(c, processes.companyId)),
              ),
              n(
                db
                  .select({ n: count() })
                  .from(processes)
                  .where(
                    and(
                      inScope(c, processes.companyId),
                      isNull(processes.ownerPositionId),
                    ),
                  ),
              ),
            ]);
            out.processes = { total, withoutOwner: noOwner };
          })(),
        );
      if (mod("incidents") && can("incidents:read"))
        jobs.push(
          (async () => {
            const open = and(
              inScope(c, incidents.companyId),
              inArray(incidents.status, ["new", "assessing", "handling"]),
            );
            const [inc, ev, un] = await Promise.all([
              n(
                db
                  .select({ n: count() })
                  .from(incidents)
                  .where(and(open, eq(incidents.kind, "incident"))),
              ),
              n(
                db
                  .select({ n: count() })
                  .from(incidents)
                  .where(and(open, eq(incidents.kind, "event"))),
              ),
              n(
                db
                  .select({ n: count() })
                  .from(incidents)
                  .where(and(open, eq(incidents.kind, "unassessed"))),
              ),
            ]);
            out.incidents = { open: inc, openEvents: ev, unassessed: un };
          })(),
        );
      if (mod("audits") && can("audits:read"))
        jobs.push(
          (async () => {
            const openF = and(
              inScope(c, audits.companyId),
              inArray(auditFindings.status, ["open", "in_progress"]),
            );
            const [planned, openFindings, overdue, major] = await Promise.all([
              n(
                db
                  .select({ n: count() })
                  .from(audits)
                  .where(
                    and(
                      inScope(c, audits.companyId),
                      inArray(audits.status, ["planned", "in_progress"]),
                    ),
                  ),
              ),
              n(
                db
                  .select({ n: count() })
                  .from(auditFindings)
                  .innerJoin(audits, eq(audits.id, auditFindings.auditId))
                  .where(openF),
              ),
              n(
                db
                  .select({ n: count() })
                  .from(auditFindings)
                  .innerJoin(audits, eq(audits.id, auditFindings.auditId))
                  .where(and(openF, lt(auditFindings.dueDate, today))),
              ),
              n(
                db
                  .select({ n: count() })
                  .from(auditFindings)
                  .innerJoin(audits, eq(audits.id, auditFindings.auditId))
                  .where(and(openF, eq(auditFindings.severity, "major"))),
              ),
            ]);
            out.audits = {
              planned,
              openFindings,
              overdueFindings: overdue,
              major,
            };
          })(),
        );
      if (mod("policies") && can("policies:read"))
        jobs.push(
          (async () => {
            const [active, draft] = await Promise.all([
              n(
                db
                  .select({ n: count() })
                  .from(policies)
                  .where(
                    and(
                      inScope(c, policies.companyId),
                      eq(policies.status, "active"),
                    ),
                  ),
              ),
              n(
                db
                  .select({ n: count() })
                  .from(policies)
                  .where(
                    and(
                      inScope(c, policies.companyId),
                      eq(policies.status, "draft"),
                    ),
                  ),
              ),
            ]);
            out.policies = { active, draft };
          })(),
        );
      if (mod("awareness") && can("awareness:read"))
        jobs.push(
          (async () => {
            out.awareness = {
              courses: await n(
                db
                  .select({ n: count() })
                  .from(trainingCourses)
                  .where(
                    and(
                      inScope(c, trainingCourses.companyId),
                      eq(trainingCourses.active, true),
                    ),
                  ),
              ),
            };
          })(),
        );
      if (mod("suppliers") && can("suppliers:read"))
        jobs.push(
          (async () => {
            const [total, sig] = await Promise.all([
              n(
                db
                  .select({ n: count() })
                  .from(suppliers)
                  .where(
                    and(
                      inScope(c, suppliers.companyId),
                      eq(suppliers.status, "active"),
                    ),
                  ),
              ),
              n(
                db
                  .select({ n: count() })
                  .from(suppliers)
                  .where(
                    and(
                      inScope(c, suppliers.companyId),
                      eq(suppliers.status, "active"),
                      eq(suppliers.significant, true),
                    ),
                  ),
              ),
            ]);
            out.suppliers = { total, significant: sig };
          })(),
        );
      if (mod("isms") && can("isms:read"))
        jobs.push(
          (async () => {
            const open = and(
              inScope(c, changes.companyId),
              inArray(changes.status, ["proposed", "assessed", "approved"]),
            );
            const [all, sig] = await Promise.all([
              n(db.select({ n: count() }).from(changes).where(open)),
              n(
                db
                  .select({ n: count() })
                  .from(changes)
                  .where(and(open, eq(changes.significant, true))),
              ),
            ]);
            out.isms = { openChanges: all, significantOpen: sig };
          })(),
        );
      if (mod("continuity") && can("bia:read"))
        jobs.push(
          (async () => {
            const [bia, plans, approved] = await Promise.all([
              n(
                db
                  .select({ n: count() })
                  .from(biaAssessments)
                  .where(inScope(c, biaAssessments.companyId)),
              ),
              n(
                db
                  .select({ n: count() })
                  .from(continuityPlans)
                  .where(
                    and(
                      inScope(c, continuityPlans.companyId),
                      inArray(continuityPlans.status, ["draft", "approved"]),
                    ),
                  ),
              ),
              n(
                db
                  .select({ n: count() })
                  .from(continuityPlans)
                  .where(
                    and(
                      inScope(c, continuityPlans.companyId),
                      eq(continuityPlans.status, "approved"),
                    ),
                  ),
              ),
            ]);
            out.continuity = { bia, plans, approvedPlans: approved };
          })(),
        );
      if (mod("gdpr") && can("gdpr:read"))
      jobs.push(
        (async () => {
          const acts = await db.select({ id: processingActivities.id, status: processingActivities.status, crit: processingActivities.dpiaCriteria }).from(processingActivities).where(and(inScope(c, processingActivities.companyId), inArray(processingActivities.status, ["active", "draft"])));
          const done = new Set((acts.length ? await db.select({ a: dpias.activityId }).from(dpias).where(and(inArray(dpias.activityId, acts.map((x) => x.id)), eq(dpias.status, "completed"))) : []).map((x) => x.a));
          out.gdpr = { activities: acts.filter((x) => x.status === "active").length, drafts: acts.filter((x) => x.status === "draft").length, dpiaMissing: acts.filter((x) => dpiaRequired(x.crit).required && !done.has(x.id)).length };
        })(),
      );
    if (mod("identity") && can("identity:read"))
      jobs.push(
        (async () => {
          const [[f], [a], [src]] = await Promise.all([
            db
              .select({
                critical: sql<number>`count(*) filter (where ${identityFindings.severity} = 'critical')`.mapWith(Number),
                high: sql<number>`count(*) filter (where ${identityFindings.severity} = 'high')`.mapWith(Number),
                open: count(),
              })
              .from(identityFindings)
              .where(and(inScope(c, identityFindings.companyId), eq(identityFindings.status, "open"))),
            db
              .select({ privileged: count() })
              .from(identityAccounts)
              .where(and(inScope(c, identityAccounts.companyId), isNull(identityAccounts.removedAt), eq(identityAccounts.enabled, true), eq(identityAccounts.privileged, true))),
            db
              .select({ n: count(), errors: sql<number>`count(*) filter (where ${identitySources.lastStatus} = 'error')`.mapWith(Number) })
              .from(identitySources)
              .where(and(inScope(c, identitySources.companyId), eq(identitySources.enabled, true))),
          ]);
          out.identity = { sources: src?.n ?? 0, sourceErrors: src?.errors ?? 0, open: f?.open ?? 0, critical: f?.critical ?? 0, high: f?.high ?? 0, privileged: a?.privileged ?? 0 };
        })(),
      );
    if (can("ai:use"))
        jobs.push(
          (async () => {
            out.ai = {
              proposed: await n(
                db
                  .select({ n: count() })
                  .from(aiSuggestions)
                  .where(
                    and(
                      inScope(c, aiSuggestions.companyId),
                      eq(aiSuggestions.status, "proposed"),
                    ),
                  ),
              ),
            };
          })(),
        );
      jobs.push(
        (async () => {
          const kinds = kindsForModules(base.enabledModules as string[]);
          for (const k of [...kinds]) if (!can(NEED[k])) kinds.delete(k);
          if (!kinds.size) return;
          const list = await collectObligations(db, {
            companyIds: scopeOf(c).ids,
            leadDays: notif.leadDays,
            kinds,
            includeLater: false,
            t,
          });
          const byKind: NonNullable<DashboardDto["obligations"]>["byKind"] = {};
          for (const o of list) {
            const b = (byKind[o.kind] ??= { overdue: 0, soon: 0 });
            if (o.urgency === "overdue") b.overdue++;
            else b.soon++;
          }
          out.obligations = {
            overdue: list.filter((o) => o.urgency === "overdue").length,
            soon: list.filter((o) => o.urgency !== "overdue").length,
            byKind,
            top: list.slice(0, 10),
          };
        })(),
      );
      await Promise.all(jobs);
      return c.json(out);
    },
  );
}
