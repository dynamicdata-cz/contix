import {
  CONTROL_LABELS,
  MONITOR_LABELS,
  TrustAccessRequestInput,
  TrustSettingsInput,
  type PublicTrustDto,
  type TrustAccessRequestDto,
  type TrustSettings,
  type TrustSettingsDto,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { createHash, randomBytes } from "node:crypto";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, scopeOf } from "../../auth/scope";
import { audit, clientIp, getSettings, type AppEnv } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { companies, controlMonitorRuns, controlMonitors, controls, policies, policyFiles, policyVersions, suppliers, trustAccessRequests, trustCenters, users } from "../../db/schema";
import { html } from "../documents/render";
import { getNotificationSettings, smtpMailer, type Mailer } from "../notifications/service";
import { stampPdf } from "../policies/convert";

/* ============================================================
 * Trust Center (ADR-099): veřejná stránka důvěry společnosti na /t/<slug>.
 * Ven jde jen to, co správce výslovně vybral: certifikace (ručně), souhrn opatření podle kategorií, souhrn monitorování
 * (úspěšnost, bez podrobností běhů), vybraní subdodavatelé (název, země, účel), dokumenty (platná schválená verze jako PDF).
 * Dokument „NDA“ jen se schváleným přístupem: token jen v odkazu (v DB SHA-256), platnost `accessDays`, PDF s doložkou příjemce.
 * Žádost o přístup: povinné přijetí NDA, past na roboty, limity (3 čekající na e-mail, 20 za den z jedné IP).
 * ============================================================ */

const DAY = 86_400_000;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const today = () => new Date().toISOString().slice(0, 10);

type TcRow = typeof trustCenters.$inferSelect;

async function latestPdf(db: Db, policyId: string) {
  const [v] = await db
    .select({ id: policyVersions.id, version: policyVersions.version, effectiveFrom: policyVersions.effectiveFrom })
    .from(policyVersions)
    .where(and(eq(policyVersions.policyId, policyId), eq(policyVersions.status, "approved")))
    .orderBy(desc(policyVersions.approvedAt))
    .limit(1);
  if (!v) return null;
  const files = await db.select().from(policyFiles).where(and(eq(policyFiles.versionId, v.id), isNull(policyFiles.supersededAt)));
  const f = files.find((x) => x.pdfStatus === "native" || x.content.subarray(0, 5).toString() === "%PDF-") ?? files.find((x) => x.pdfStatus === "ok" && x.pdf);
  if (!f) return { v, pdf: null as Uint8Array | null, filename: null as string | null };
  const pdf = f.pdfStatus === "ok" && f.pdf && f.content.subarray(0, 5).toString() !== "%PDF-" ? f.pdf : f.content;
  return { v, pdf: new Uint8Array(pdf), filename: `${f.filename.replace(/\.[^.]+$/, "")}.pdf` };
}

/** Veřejný profil (čistě čtecí). */
async function publicProfile(db: Db, tc: TcRow, access: PublicTrustDto["access"]): Promise<PublicTrustDto> {
  const s = tc.settings;
  const [co] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, tc.companyId));
  let ctl: PublicTrustDto["controls"] = null;
  if (s.showControls) {
    const rows = await db
      .select({ category: controls.category, n: sql<number>`count(*)::int`, impl: sql<number>`count(*) filter (where ${controls.status} = 'implemented')::int` })
      .from(controls)
      .where(and(eq(controls.companyId, tc.companyId), sql`${controls.status} <> 'not_applicable'`))
      .groupBy(controls.category);
    ctl = rows.map((r) => ({ category: CONTROL_LABELS.category[r.category as keyof typeof CONTROL_LABELS.category] ?? String(r.category ?? "—"), implemented: r.impl, total: r.n }));
  }
  let mon: PublicTrustDto["monitoring"] = null;
  if (s.showMonitoring) {
    const ms = await db.select({ id: controlMonitors.id, kind: controlMonitors.kind, last: controlMonitors.lastResult }).from(controlMonitors).where(and(eq(controlMonitors.companyId, tc.companyId), eq(controlMonitors.enabled, true)));
    const rates = ms.length
      ? await db
          .select({ id: controlMonitorRuns.monitorId, n: sql<number>`count(*)::int`, ok: sql<number>`count(*) filter (where ${controlMonitorRuns.result} = 'pass')::int` })
          .from(controlMonitorRuns)
          .where(and(inArray(controlMonitorRuns.monitorId, ms.map((m) => m.id)), gte(controlMonitorRuns.runAt, new Date(Date.now() - 90 * DAY))))
          .groupBy(controlMonitorRuns.monitorId)
      : [];
    mon = ms.map((m) => {
      const r = rates.find((x) => x.id === m.id);
      return { label: MONITOR_LABELS.kind[m.kind], passRate90: r?.n ? Math.round((r.ok / r.n) * 100) : null, lastResult: m.last };
    });
  }
  const subs = s.subprocessorIds.length ? await db.select({ name: suppliers.name, country: suppliers.country, purpose: suppliers.supplyDescription }).from(suppliers).where(and(inArray(suppliers.id, s.subprocessorIds), eq(suppliers.companyId, tc.companyId))) : [];
  const docs = s.documents.length ? await db.select({ id: policies.id, title: policies.title, code: policies.code, status: policies.status }).from(policies).where(and(inArray(policies.id, s.documents.map((d) => d.policyId)), eq(policies.companyId, tc.companyId))) : [];
  const documents: PublicTrustDto["documents"] = [];
  for (const d of s.documents) {
    const p = docs.find((x) => x.id === d.policyId);
    if (!p || p.status !== "active") continue;
    const f = await latestPdf(db, p.id);
    documents.push({ id: p.id, title: `${p.code ? `${p.code} ` : ""}${p.title}`, version: f?.v.version ?? null, effectiveFrom: f?.v.effectiveFrom ?? null, access: d.access, available: !!f?.pdf });
  }
  return {
    slug: tc.slug,
    title: s.title,
    organization: co?.name ?? (await getSettings(db)).organizationName ?? "",
    intro: s.intro ?? null,
    contactEmail: s.contactEmail ?? null,
    updatedAt: tc.updatedAt.toISOString(),
    certifications: s.certifications.map((x) => ({ ...x, valid: !x.validUntil || x.validUntil >= today() })),
    controls: ctl,
    monitoring: mon,
    subprocessors: subs.map((x) => ({ name: x.name, country: x.country, purpose: x.purpose ? x.purpose.slice(0, 200) : null })),
    documents,
    ndaText: s.ndaText ?? null,
    access,
  };
}

async function accessOf(db: Db, tc: TcRow, token: string | undefined) {
  if (!token || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [r] = await db.select().from(trustAccessRequests).where(and(eq(trustAccessRequests.tokenHash, hash(token)), eq(trustAccessRequests.trustCenterId, tc.id)));
  if (!r || r.status !== "approved" || !r.expiresAt || r.expiresAt < new Date()) return null;
  return r;
}

export function publicTrustRoutes(db: Db) {
  async function center(slug: string) {
    if (!((await getSettings(db)).enabledModules as string[]).includes("trust")) throw new HTTPException(404, { message: "Stránka nenalezena" });
    const [tc] = await db.select().from(trustCenters).where(eq(trustCenters.slug, slug.toLowerCase()));
    if (!tc || !tc.enabled) throw new HTTPException(404, { message: "Stránka nenalezena" });
    return tc;
  }
  return new Hono()
    .get("/:slug", async (c) => {
      const tc = await center(c.req.param("slug"));
      const a = await accessOf(db, tc, c.req.query("t"));
      c.header("cache-control", "no-store");
      return c.json(await publicProfile(db, tc, a ? { name: a.name, organization: a.organization, expiresAt: a.expiresAt!.toISOString() } : null));
    })
    .get("/:slug/docs/:policyId", async (c) => {
      const tc = await center(c.req.param("slug"));
      const d = tc.settings.documents.find((x) => x.policyId === c.req.param("policyId"));
      if (!d) throw new HTTPException(404, { message: "Dokument nenalezen" });
      const a = d.access === "nda" ? await accessOf(db, tc, c.req.query("t")) : null;
      if (d.access === "nda" && !a) throw new HTTPException(403, { message: "Dokument je dostupný jen po schválení žádosti o přístup." });
      const [p] = await db.select().from(policies).where(and(eq(policies.id, d.policyId), eq(policies.companyId, tc.companyId)));
      if (!p || p.status !== "active") throw new HTTPException(404, { message: "Dokument nenalezen" });
      const f = await latestPdf(db, p.id);
      if (!f?.pdf) throw new HTTPException(404, { message: "Dokument nenalezen" });
      const when = new Date().toISOString().slice(0, 16).replace("T", " ");
      const name = `${p.code ? `${p.code} ` : ""}${p.title}`;
      const { bytes } = await stampPdf(f.pdf, {
        footer: a
          ? [`${name} – verze ${f.v.version}. Důvěrné – poskytnuto na základě NDA.`, `Příjemce: ${a.name}, ${a.organization} (${a.email}) · staženo ${when} UTC`]
          : [`${name} – verze ${f.v.version} · zveřejněno v Trust Center ${tc.settings.title}`, `Staženo ${when} UTC`],
        watermark: a ? a.email : null,
      });
      if (a) await db.update(trustAccessRequests).set({ downloads: sql`${trustAccessRequests.downloads} + 1` }).where(eq(trustAccessRequests.id, a.id));
      await audit(db, { email: a?.email ?? "public@trust", action: "trust.document_downloaded", entityType: "policy", entityId: p.id, details: { slug: tc.slug, access: d.access, requestId: a?.id ?? null, ip: clientIp(c as never) } });
      return new Response(bytes, {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="${(f.filename ?? "dokument.pdf").replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(f.filename ?? "dokument.pdf")}`,
          "x-content-type-options": "nosniff",
          "cache-control": "private, no-store",
        },
      });
    })
    .post("/:slug/requests", zValidator("json", TrustAccessRequestInput), async (c) => {
      const tc = await center(c.req.param("slug"));
      const i = c.req.valid("json");
      const ip = clientIp(c as never);
      const since = new Date(Date.now() - DAY);
      const email = i.email.toLowerCase();
      const [byEmail] = await db.select({ n: sql<number>`count(*)::int` }).from(trustAccessRequests).where(and(eq(trustAccessRequests.trustCenterId, tc.id), eq(trustAccessRequests.email, email), eq(trustAccessRequests.status, "pending")));
      const [byIp] = ip ? await db.select({ n: sql<number>`count(*)::int` }).from(trustAccessRequests).where(and(eq(trustAccessRequests.ip, ip), gte(trustAccessRequests.createdAt, since))) : [{ n: 0 }];
      if ((byEmail?.n ?? 0) >= 3 || (byIp?.n ?? 0) >= 20) throw new HTTPException(429, { message: "Příliš mnoho žádostí – zkuste to později." });
      await db.insert(trustAccessRequests).values({ trustCenterId: tc.id, companyId: tc.companyId, name: i.name, email, organization: i.organization, reason: i.reason ?? null, ndaAcceptedAt: new Date(), ip });
      await audit(db, { email, action: "trust.access_requested", entityType: "trust_center", entityId: tc.id, details: { organization: i.organization, ip } });
      return c.json({ ok: true }, 201);
    });
}

export function trustCenterRoutes(deps: { db: Db; config: Config; mailer?: Mailer }) {
  const { db, config } = deps;
  const companyOf = (c: Context<AppEnv>) => {
    const s = scopeOf(c);
    const id = s.active ?? s.home;
    assertScope(c, id);
    return id;
  };
  const urlOf = (slug: string) => `${config.APP_URL.replace(/\/+$/, "")}/t/${slug}`;
  async function dto(companyId: string): Promise<TrustSettingsDto | null> {
    const [tc] = await db.select().from(trustCenters).where(eq(trustCenters.companyId, companyId));
    if (!tc) return null;
    const [p] = await db.select({ n: sql<number>`count(*)::int` }).from(trustAccessRequests).where(and(eq(trustAccessRequests.trustCenterId, tc.id), eq(trustAccessRequests.status, "pending")));
    return { ...tc.settings, enabled: tc.enabled, slug: tc.slug, companyId, url: tc.enabled ? urlOf(tc.slug) : null, pendingRequests: p?.n ?? 0 };
  }
  async function request(c: Context<AppEnv>, id: string) {
    const [r] = await db.select().from(trustAccessRequests).where(eq(trustAccessRequests.id, id));
    if (!r) throw new HTTPException(404, { message: "Žádost nenalezena" });
    assertScope(c, r.companyId, "Žádost nenalezena");
    if (!hasPermIn(c, "trust:write", r.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
    return r;
  }

  return new Hono<AppEnv>()
    .use("*", requireModule(db, "trust"))
    .get("/", requirePerm("trust:read"), async (c) => c.json(await dto(companyOf(c))))
    .put("/", requirePerm("trust:write"), zValidator("json", TrustSettingsInput), async (c) => {
      const companyId = companyOf(c);
      if (!hasPermIn(c, "trust:write", companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
      const s = c.req.valid("json") as TrustSettings;
      // dokumenty a subdodavatelé jen z této společnosti
      const pids = s.documents.map((d) => d.policyId);
      if (pids.length && (await db.select({ id: policies.id }).from(policies).where(and(inArray(policies.id, pids), eq(policies.companyId, companyId)))).length !== new Set(pids).size)
        throw new HTTPException(400, { message: "Dokument nepatří do společnosti." });
      if (s.subprocessorIds.length && (await db.select({ id: suppliers.id }).from(suppliers).where(and(inArray(suppliers.id, s.subprocessorIds), eq(suppliers.companyId, companyId)))).length !== new Set(s.subprocessorIds).size)
        throw new HTTPException(400, { message: "Dodavatel nepatří do společnosti." });
      const [taken] = await db.select({ companyId: trustCenters.companyId }).from(trustCenters).where(eq(trustCenters.slug, s.slug));
      if (taken && taken.companyId !== companyId) throw new HTTPException(409, { message: "Adresa stránky je už obsazená." });
      await db
        .insert(trustCenters)
        .values({ companyId, enabled: s.enabled, slug: s.slug, settings: s, updatedById: currentUser(c).id })
        .onConflictDoUpdate({ target: trustCenters.companyId, set: { enabled: s.enabled, slug: s.slug, settings: s, updatedById: currentUser(c).id, updatedAt: new Date() } });
      await audit(db, { c, user: currentUser(c), action: "trust_center.updated", details: { enabled: s.enabled, slug: s.slug, documents: s.documents.length, subprocessors: s.subprocessorIds.length } });
      return c.json(await dto(companyId));
    })
    .get("/requests", requirePerm("trust:read"), async (c) => {
      const companyId = companyOf(c);
      const rows = await db
        .select({ r: trustAccessRequests, by: users.displayName })
        .from(trustAccessRequests)
        .leftJoin(users, eq(users.id, trustAccessRequests.decidedById))
        .where(eq(trustAccessRequests.companyId, companyId))
        .orderBy(desc(trustAccessRequests.createdAt))
        .limit(300);
      const out: TrustAccessRequestDto[] = rows.map(({ r, by }) => ({ id: r.id, name: r.name, email: r.email, organization: r.organization, reason: r.reason, status: r.status, createdAt: r.createdAt.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null, decidedByName: by ?? null, expiresAt: r.expiresAt?.toISOString() ?? null, downloads: r.downloads }));
      return c.json(out);
    })
    /** Schválení: nový token (jen v odkazu), platnost podle nastavení; odkaz e-mailem žadateli, jinak ho správce předá sám. */
    .post("/requests/:id/approve", requirePerm("trust:write"), async (c) => {
      const r = await request(c, c.req.param("id"));
      if (r.status === "rejected") throw new HTTPException(409, { message: "Zamítnutou žádost nelze schválit." });
      const [tc] = await db.select().from(trustCenters).where(eq(trustCenters.id, r.trustCenterId));
      const token = randomBytes(24).toString("base64url");
      const expiresAt = new Date(Date.now() + (tc!.settings.accessDays ?? 30) * DAY);
      await db.update(trustAccessRequests).set({ status: "approved", tokenHash: hash(token), expiresAt, decidedById: currentUser(c).id, decidedAt: new Date(), updatedAt: new Date() }).where(eq(trustAccessRequests.id, r.id));
      const link = `${urlOf(tc!.slug)}?t=${token}`;
      let mailed = false;
      let mailError: string | null = null;
      const ns = await getNotificationSettings(db);
      if (ns.smtpHost && ns.smtpFrom) {
        const e = html.esc;
        try {
          await (deps.mailer ?? smtpMailer(ns, config)).send({
            to: r.email,
            subject: `${tc!.settings.title} – přístup k dokumentům`,
            text: `Dobrý den,\n\nvaše žádost o přístup k dokumentům ${tc!.settings.title} byla schválena. Odkaz platí do ${expiresAt.toISOString().slice(0, 10)}:\n\n${link}\n`,
            html: `<p>Dobrý den,</p><p>vaše žádost o přístup k dokumentům <b>${e(tc!.settings.title)}</b> byla schválena. Odkaz platí do ${e(expiresAt.toISOString().slice(0, 10))}:</p><p><a href="${e(link)}">${e(link)}</a></p>`,
          });
          mailed = true;
        } catch (err) {
          mailError = (err as Error).message.slice(0, 300);
        }
      }
      await audit(db, { c, user: currentUser(c), action: "trust.access_approved", entityType: "trust_center", entityId: r.trustCenterId, details: { requestId: r.id, email: r.email, expiresAt, mailed } });
      return c.json({ link, mailed, mailError, expiresAt: expiresAt.toISOString() });
    })
    .post("/requests/:id/reject", requirePerm("trust:write"), async (c) => {
      const r = await request(c, c.req.param("id"));
      await db.update(trustAccessRequests).set({ status: "rejected", tokenHash: null, decidedById: currentUser(c).id, decidedAt: new Date(), updatedAt: new Date() }).where(eq(trustAccessRequests.id, r.id));
      await audit(db, { c, user: currentUser(c), action: "trust.access_rejected", entityType: "trust_center", entityId: r.trustCenterId, details: { requestId: r.id } });
      return c.json({ ok: true });
    })
    .post("/requests/:id/revoke", requirePerm("trust:write"), async (c) => {
      const r = await request(c, c.req.param("id"));
      await db.update(trustAccessRequests).set({ status: "revoked", tokenHash: null, updatedAt: new Date() }).where(eq(trustAccessRequests.id, r.id));
      await audit(db, { c, user: currentUser(c), action: "trust.access_revoked", entityType: "trust_center", entityId: r.trustCenterId, details: { requestId: r.id } });
      return c.json({ ok: true });
    });
}
