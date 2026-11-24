import { buildIcs, CalendarFeedInput, CALENDAR_FEED_PREFIX, deadlineBasis, DEADLINE_BASIS_LABELS, GROUP_SCOPE, RESTORE_TEST_MAX_DAYS, urgencyOf, type CalendarDto, type CalendarFeedDto, type CalendarItemDto, type Translate } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { currentUser, hasPerm, requirePerm } from "../../auth/middleware";
import { randomToken, sha256 } from "../../auth/crypto";
import { resolveScope, scopeOf } from "../../auth/scope";
import { audit, getSettings, type AppEnv, type AuthState } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { backupRuns, calendarFeeds, companies, users } from "../../db/schema";
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

const MAX_FEEDS = 10;
const feedUrl = (config: Config, token: string) => `${config.APP_URL.replace(/\/+$/, "")}/api/public/calendar/${token}.ics`;

async function feedDtos(db: Db, userId: string): Promise<CalendarFeedDto[]> {
  const rows = await db
    .select({ f: calendarFeeds, companyName: companies.name })
    .from(calendarFeeds)
    .leftJoin(companies, eq(companies.id, calendarFeeds.companyId))
    .where(and(eq(calendarFeeds.userId, userId), isNull(calendarFeeds.revokedAt)))
    .orderBy(desc(calendarFeeds.createdAt));
  return rows.map(({ f, companyName }) => ({
    id: f.id,
    name: f.name,
    companyId: f.companyId,
    companyName: companyName ?? null,
    legalOnly: f.legalOnly,
    lastUsedAt: f.lastUsedAt?.toISOString() ?? null,
    createdAt: f.createdAt.toISOString(),
  }));
}

export function calendarRoutes(db: Db, config: Config) {
  return new Hono<AppEnv>()
    /* ---- odběr kalendáře adresou (v1.101, ADR-195) – vlastní odběry přihlášeného uživatele ---- */
    .get("/feeds", requirePerm("obligations:self"), async (c) => c.json(await feedDtos(db, currentUser(c).id)))
    .post("/feeds", requirePerm("obligations:self"), zValidator("json", CalendarFeedInput), async (c) => {
      const user = currentUser(c);
      const v = c.req.valid("json");
      if (v.companyId && !scopeOf(c).accessible.includes(v.companyId)) throw new HTTPException(400, { message: "Ke společnosti nemáte přístup" });
      if ((await feedDtos(db, user.id)).length >= MAX_FEEDS) throw new HTTPException(400, { message: `Nejvýš ${MAX_FEEDS} odběrů – nepoužívané zrušte.` });
      const token = `${CALENDAR_FEED_PREFIX}${randomToken(32)}`;
      const [f] = await db
        .insert(calendarFeeds)
        .values({ userId: user.id, name: v.name, tokenHash: sha256(token), companyId: v.companyId ?? null, legalOnly: v.legalOnly })
        .returning();
      await audit(db, { c, user, action: "calendar.feed_created", details: { id: f!.id, name: v.name, companyId: v.companyId ?? null } });
      return c.json({ feed: (await feedDtos(db, user.id)).find((x) => x.id === f!.id)!, url: feedUrl(config, token) }, 201);
    })
    .delete("/feeds/:id", requirePerm("obligations:self"), zValidator("param", z.object({ id: z.string().uuid() })), async (c) => {
      const user = currentUser(c);
      const r = await db
        .update(calendarFeeds)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(calendarFeeds.id, c.req.valid("param").id), eq(calendarFeeds.userId, user.id), isNull(calendarFeeds.revokedAt)))
        .returning({ id: calendarFeeds.id });
      if (!r.length) throw new HTTPException(404, { message: "Odběr nenalezen" });
      await audit(db, { c, user, action: "calendar.feed_revoked", details: { id: r[0]!.id } });
      return c.json({ ok: true });
    })
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


/**
 * Veřejná adresa odběru: `/api/public/calendar/<token>.ics` – bez přihlášení, token v cestě (kalendářové aplikace
 * neumí posílat hlavičky). Oprávnění a rozsah se berou z uživatele v okamžiku stažení; neaktivní uživatel nebo
 * zrušený odběr = 404. Okno: 60 dní zpět až ~13 měsíců dopředu.
 */
export function publicCalendarRoutes(db: Db, config: Config) {
  return new Hono<AppEnv>().get("/:file", async (c) => {
    const m = c.req.param("file").match(/^(cal_[A-Za-z0-9_-]{20,})\.ics$/);
    const notFound = () => c.text("Nenalezeno", 404);
    if (!m) return notFound();
    const [row] = await db.select().from(calendarFeeds).innerJoin(users, eq(users.id, calendarFeeds.userId)).where(eq(calendarFeeds.tokenHash, sha256(m[1]!)));
    if (!row || row.calendar_feeds.revokedAt || !row.users.isActive) return notFound();
    const feed = row.calendar_feeds;
    const { scope, permissions } = await resolveScope(db, row.users.id, row.users.companyId, feed.companyId ?? GROUP_SCOPE);
    if (feed.companyId && scope.active !== feed.companyId) return notFound();
    if (!permissions.has("obligations:self")) return notFound();
    c.set("auth", { user: row.users, session: {} as AuthState["session"], permissions, scope });
    const t = await tFor(db, c);
    const from = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10);
    const data = await calendarItems(db, c, { from, legal: feed.legalOnly ? "1" : "0" }, t);
    const items = data.items.filter((i) => i.due.slice(0, 10) >= from);
    await db.update(calendarFeeds).set({ lastUsedAt: new Date() }).where(eq(calendarFeeds.id, feed.id));
    const body = buildIcs(items, { appUrl: config.APP_URL, calendarName: feed.name, basisLabel: (b) => t.lbl(DEADLINE_BASIS_LABELS[b]), alarmDays: 7 });
    return c.body(body, 200, { "content-type": "text/calendar; charset=utf-8", "cache-control": "private, max-age=900" });
  });
}
