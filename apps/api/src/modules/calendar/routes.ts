import { buildIcs, deadlineBasis, DEADLINE_BASIS_LABELS, RESTORE_TEST_MAX_DAYS, urgencyOf, type CalendarDto, type CalendarItemDto, type Translate } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { desc, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { currentUser, hasPerm, requirePerm } from "../../auth/middleware";
import { scopeOf } from "../../auth/scope";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { backupRuns } from "../../db/schema";
import { NEED } from "../dashboard/routes";
import { tFor } from "../i18n/service";
import { collectObligations, kindsForModules } from "../notifications/obligations";
import { getNotificationSettings } from "../notifications/service";

/* ============================================================
 * Kalendář zákonných lhůt + export do kalendáře (v1.98, ADR-192).
 * Zdroj = povinnosti týmu (stejné druhy a oprávnění jako přehled) + periodický test obnovy zálohy.
 * ============================================================ */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), "Neplatné datum");
const Query = z.object({
  from: DATE.optional(),
  to: DATE.optional(),
  /** 1 = jen lhůty se zákonným základem (bez interních termínů). */
  legal: z.enum(["0", "1"]).optional(),
});

const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

export async function calendarItems(db: Db, c: Context<AppEnv>, q: z.output<typeof Query>, t: Translate, now = new Date()): Promise<CalendarDto> {
  const today = now.toISOString().slice(0, 10);
  const from = q.from ?? addDays(today, -30);
  const to = q.to && q.to >= from ? q.to : addDays(from, 400);
  const [base, notif] = await Promise.all([getSettings(db), getNotificationSettings(db)]);
  const kinds = kindsForModules(base.enabledModules as string[]);
  kinds.delete("guide_step");
  for (const k of [...kinds]) if (!hasPerm(c, NEED[k] as never)) kinds.delete(k);
  const list = kinds.size ? await collectObligations(db, { companyIds: scopeOf(c).ids, leadDays: notif.leadDays, kinds, includeLater: true, t, now }) : [];
  const items: CalendarItemDto[] = [];
  for (const o of list) {
    if (!o.due) continue;
    items.push({ key: o.key, kind: o.kind, basis: deadlineBasis(o.kind), title: o.title, detail: o.detail, due: o.due, urgency: o.urgency, link: o.link, companyId: o.companyId, ownerName: o.ownerName });
  }
  // test obnovy zálohy – nejpozději RESTORE_TEST_MAX_DAYS po posledním úspěšném (v1.48 / v1.95)
  if (hasPerm(c, "admin:settings")) {
    const [rt] = await db.select().from(backupRuns).where(eq(backupRuns.kind, "restore_test")).orderBy(desc(backupRuns.startedAt)).limit(1);
    const okAt = rt && rt.status === "ok" ? (rt.finishedAt ?? rt.startedAt).toISOString().slice(0, 10) : null;
    const due = okAt ? addDays(okAt, RESTORE_TEST_MAX_DAYS) : today;
    items.push({
      key: "restore_test",
      kind: "restore_test",
      basis: "measures",
      title: t("cal.restoreTest"),
      detail: okAt ? t("cal.restoreTestLast", { date: okAt }) : t("cal.restoreTestNone"),
      due,
      urgency: urgencyOf(due, notif.leadDays, now),
      link: "/admin/ops",
      companyId: null,
      ownerName: null,
    });
  }
  const out = items
    .filter((i) => (q.legal !== "1" || i.basis !== "internal") && (i.urgency === "overdue" || (i.due.slice(0, 10) >= from && i.due.slice(0, 10) <= to)))
    .sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title));
  return { from, to, items: out };
}

const PERMS = ["obligations:self", "assets:read", "risks:read", "controls:read", "isms:read", "incidents:read", "audits:read", "policies:read", "identity:read"] as const;

export function calendarRoutes(db: Db, config: Config) {
  return new Hono<AppEnv>()
    .get("/", requirePerm(...PERMS), zValidator("query", Query), async (c) => c.json(await calendarItems(db, c, c.req.valid("query"), await tFor(db, c))))
    .get("/contix-lhuty.ics", requirePerm(...PERMS), zValidator("query", Query), async (c) => {
      const t = await tFor(db, c);
      const data = await calendarItems(db, c, c.req.valid("query"), t);
      // do kalendáře nepatří položky dávno po termínu – jen od začátku období
      const items = data.items.filter((i) => i.due.slice(0, 10) >= data.from);
      const body = buildIcs(items, { appUrl: config.APP_URL, calendarName: t("cal.icsName"), basisLabel: (b) => t.lbl(DEADLINE_BASIS_LABELS[b]), alarmDays: 7 });
      await audit(db, { c, user: currentUser(c), action: "calendar.export", details: { items: items.length, legal: c.req.valid("query").legal === "1" } });
      return c.body(body, 200, { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'attachment; filename="contix-lhuty.ics"', "cache-control": "no-store" });
    });
}
