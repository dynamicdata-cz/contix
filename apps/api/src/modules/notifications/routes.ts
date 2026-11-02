import { NotificationSettingsInput } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, hasPerm, requirePerm } from "../../auth/middleware";
import { scopeOf } from "../../auth/scope";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { tFor } from "../i18n/service";
import { collectObligations, kindsForModules, personalObligations } from "./obligations";
import { getNotificationSettings, runNotifications, saveNotificationSettings, testChannel, toDto, type Mailer, type TeamsPoster } from "./service";

/** Přehled povinností (v aplikaci) a nastavení upozornění. */
export function notificationRoutes(deps: { db: Db; config: Config; mailer?: Mailer; teams?: TeamsPoster }) {
  const { db, config } = deps;
  return (
    new Hono<AppEnv>()
      .get("/mine", requirePerm("obligations:self"), async (c) => {
        const [base, s] = await Promise.all([getSettings(db), getNotificationSettings(db)]);
        return c.json(await personalObligations(db, currentUser(c).id, s.leadDays, base.enabledModules, new Date(), true, await tFor(db, c)));
      })
      /** Povinnosti týmu v aktuálním rozsahu (jen druhy, ke kterým má uživatel čtecí oprávnění). */
      .get("/team", requirePerm("isms:read", "risks:read", "audits:read", "incidents:read", "policies:read", "controls:read"), async (c) => {
        const [base, s] = await Promise.all([getSettings(db), getNotificationSettings(db)]);
        const kinds = kindsForModules(base.enabledModules);
        const need: Record<string, string> = {
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
          exception_expiry: "assets:read",
          supplier_questionnaire: "suppliers:read",
          supplier_report: "suppliers:read",
          task: "actions:read",
          legal_task: "legislation:read",
        };
        for (const k of [...kinds]) if (!hasPerm(c, need[k] as never)) kinds.delete(k);
        return c.json(await collectObligations(db, { companyIds: scopeOf(c).ids, leadDays: s.leadDays, kinds, includeLater: false, t: await tFor(db, c) }));
      })
      .get("/settings", requirePerm("admin:settings"), async (c) => c.json(toDto(await getNotificationSettings(db))))
      .patch("/settings", requirePerm("admin:settings"), zValidator("json", NotificationSettingsInput), async (c) => {
        const input = c.req.valid("json");
        try {
          const s = await saveNotificationSettings(db, config, input);
          const { smtpPassword, teamsWebhookUrl, ...logged } = input;
          await audit(db, { c, user: currentUser(c), action: "notifications.settings_updated", details: { ...logged, smtpPassword: smtpPassword !== undefined ? "***" : undefined, teamsWebhookUrl: teamsWebhookUrl !== undefined ? "***" : undefined } });
          return c.json(toDto(s));
        } catch (e) {
          throw new HTTPException(400, { message: (e as Error).message });
        }
      })
      .post("/test", requirePerm("admin:settings"), zValidator("json", z.object({ channel: z.enum(["email", "teams"]), to: z.string().trim().email().optional() })), async (c) => {
        const { channel, to } = c.req.valid("json");
        const t = await tFor(db, c);
        try {
          return c.json({ ok: true, message: await testChannel(db, config, channel, to, deps, t) });
        } catch (e) {
          return c.json({ ok: false, message: (e as Error).message });
        }
      })
      .post("/run", requirePerm("admin:settings"), async (c) => {
        const r = await runNotifications({ db, config, mailer: deps.mailer, teams: deps.teams, forceDigest: true });
        await audit(db, { c, user: currentUser(c), action: "notifications.run", details: { emails: r.emails, teams: r.teams, errors: r.errors.length } });
        if (r.errors.length) throw new HTTPException(502, { message: r.errors.slice(0, 3).join("; ") });
        return c.json({ emails: r.emails, teams: r.teams });
      })
  );
}
