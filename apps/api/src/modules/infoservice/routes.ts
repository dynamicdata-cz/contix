import {
  ANY,
  cveIdsOf,
  INFO_DECIDED,
  InfoAssessmentInput,
  InfoLinkInput,
  productTermsOf,
  profileOf,
  type InfoAssessmentDto,
  type InfoAssessmentStatus,
  type InfoAssetSuggestion,
  type InfoLinkKind,
  canonicalClass,
  canonicalSeverity,
  foldStatItems,
  IncidentMonthInput,
  mergeIncidentStats,
  monthFromTitle,
  nukibReportUrls,
  parseIncidentStatsProposal,
  type IncidentStatsProposal,
  feedItemKind,
  INFO_SERVICE_DEFAULTS,
  InfoReviewInput,
  InfoServiceSettingsInput,
  parseIncidentOpendata,
  parseRssFeed,
  summarizeIncidentStats,
  type InfoFeedItemDto,
  type InfoServiceDto,
  type InfoSourceState,
  type FeedItemKind,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, hasPerm, requireModule, requirePerm } from "../../auth/middleware";
import { hasPermIn, inScope, scopeOf, settingsFor, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { appSettings, assets, assetSoftware, assetVulnerabilities, incidents, infoAssessmentAssets, infoAssessmentLinks, infoFeedItems, infoIncidentStats, infoItemReviews, positions, risks, tasks, threatIntel, users } from "../../db/schema";
import { sharedInto } from "../assets/routes";
import { parseHtmlListing } from "./html";
import type { FetchLike } from "../discovery/connectors/wazuh";
import { acquireLease } from "../ops/lease";
import { loadIntegrations } from "../soc/enrich";
import { clientFor, getAiSettings } from "../ai/service";
import { converterEnabled, pdfToText } from "../policies/convert";
import type { Config } from "../../config";

/* ============================================================
 * Informační servis regulátora (ADR-087): RSS NÚKIB a další zdroje, otevřená data o incidentech, stav Národního MISP.
 * Jen stahování veřejných zdrojů (GET) – nic se neodesílá; server bez internetu = ruční nahrání souboru.
 * ============================================================ */

const KEY = "infoservice";
const OPENDATA = "nukib-opendata";
const MANUAL = "manual";
const PDF_MAX = 20 * 1024 * 1024;
const MAX_BYTES = 10 * 1024 * 1024;
type Settings = z.infer<typeof InfoServiceSettingsInput>;
interface Stored extends Settings {
  state: Record<string, InfoSourceState>;
  lastRefreshAt: string | null;
}

async function load(db: Db): Promise<Stored> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, KEY));
  const v = (row?.value as Partial<Stored>) ?? {};
  const out = { ...INFO_SERVICE_DEFAULTS, state: {}, lastRefreshAt: null, ...v };
  // kanály uložené před v0.93 nemají vydavatele a zemi
  out.feeds = out.feeds.map((f) => ({ ...f, publisher: f.publisher ?? (f.id === "nukib" ? "NÚKIB" : f.name), country: f.country ?? (f.id === "nukib" ? "CZ" : ""), format: f.format ?? "rss", linkPrefix: f.linkPrefix ?? "" }));
  return out;
}
async function save(db: Db, patch: Partial<Stored>) {
  const next = { ...(await load(db)), ...patch };
  await db
    .insert(appSettings)
    .values({ key: KEY, value: next })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: new Date() } });
  return next;
}

async function download(url: string, fetchImpl: FetchLike): Promise<string> {
  const res = await fetchImpl(url, { headers: { accept: "application/rss+xml, application/xml, text/xml, text/csv, */*" }, signal: AbortSignal.timeout(60_000) } as RequestInit);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("Soubor je příliš velký.");
  return new TextDecoder().decode(buf);
}

/** Uloží položky zdroje – nové přidá, existující (zdroj + guid) aktualizuje; posouzení zůstávají. */
export async function storeFeedItems(db: Db, feedId: string, xml: string, feed?: { url: string; format?: "rss" | "html"; linkPrefix?: string; defaultKind?: FeedItemKind }): Promise<number> {
  const html = feed?.format === "html";
  const items = html ? parseHtmlListing(xml, feed!.url, feed!.linkPrefix ?? "") : parseRssFeed(xml);
  if (!items.length && html) throw new Error("Na stránce nejsou odkazy na novinky – zkontrolujte začátek cesty odkazů u zdroje.");
  if (!items.length) {
    // nápověda k chybě: adresa vede na webovou stránku místo kanálu RSS
    const head = xml.slice(0, 2000).toLowerCase();
    if (/<html|<!doctype html/.test(head)) throw new Error("Adresa vrací webovou stránku, ne kanál RSS / Atom – ověřte adresu kanálu u zdroje (odkaz „RSS“ na jeho webu).");
    throw new Error("Zdroj neobsahuje žádné položky RSS / Atom.");
  }
  const now = new Date();
  for (const i of items)
    await db
      .insert(infoFeedItems)
      .values({ feedId, guid: i.guid, kind: feedItemKind(i, feed?.defaultKind), title: i.title, link: i.link, summary: i.summary, category: i.category, publishedAt: i.publishedAt ? new Date(i.publishedAt) : html ? now : null, fetchedAt: now })
      .onConflictDoUpdate({
        target: [infoFeedItems.feedId, infoFeedItems.guid],
        // u stránky bez data zůstává datum prvního výskytu
        set: { title: i.title, link: i.link, summary: i.summary, category: i.category, kind: feedItemKind(i, feed?.defaultKind), ...(i.publishedAt || !html ? { publishedAt: i.publishedAt ? new Date(i.publishedAt) : null } : {}), fetchedAt: now },
      });
  return items.length;
}

/** Nahradí otevřená data o incidentech. */
export async function storeOpendata(db: Db, csv: string): Promise<number> {
  const { rows, errors } = parseIncidentOpendata(csv);
  if (!rows.length) throw new Error(errors[0] ?? "Soubor neobsahuje žádné řádky.");
  await db.transaction(async (tx) => {
    await tx.delete(infoIncidentStats).where(eq(infoIncidentStats.source, OPENDATA));
    for (let i = 0; i < rows.length; i += 2000) await tx.insert(infoIncidentStats).values(rows.slice(i, i + 2000).map((r) => ({ source: OPENDATA, ...r })));
  });
  return rows.reduce((s, r) => s + r.count, 0);
}

/** Stažení zapnutých zdrojů (chyba jednoho nebrání ostatním). */
export async function refreshInfoService(db: Db, fetchImpl: FetchLike = fetch as FetchLike) {
  const s = await load(db);
  const state = { ...s.state };
  for (const f of s.feeds.filter((x) => x.enabled)) {
    try {
      state[f.id] = { at: new Date().toISOString(), count: await storeFeedItems(db, f.id, await download(f.url, fetchImpl), f), error: null };
    } catch (e) {
      state[f.id] = { at: new Date().toISOString(), count: state[f.id]?.count ?? 0, error: (e as Error).message.slice(0, 300) };
    }
  }
  if (s.opendataEnabled) {
    try {
      state[OPENDATA] = { at: new Date().toISOString(), count: await storeOpendata(db, await download(s.opendataUrl, fetchImpl)), error: null };
    } catch (e) {
      state[OPENDATA] = { at: new Date().toISOString(), count: state[OPENDATA]?.count ?? 0, error: (e as Error).message.slice(0, 300) };
    }
  }
  await save(db, { state, lastRefreshAt: new Date().toISOString() });
  return state;
}

/** Plánovač: podle intervalu, je-li zapnuto automatické stahování a modul Legislativa. */
export async function processInfoService(db: Db, fetchImpl?: FetchLike, now = new Date()) {
  const s = await load(db);
  if (!s.autoRefresh) return null;
  if (s.lastRefreshAt && now.getTime() - new Date(s.lastRefreshAt).getTime() < s.intervalHours * 3600_000) return null;
  if (!(await acquireLease(db, "infoservice", 10 * 60_000))) return null;
  return refreshInfoService(db, fetchImpl);
}

/** Odkazy na PDF ve stránce aktuality (absolutní, jen http(s)). */
export function pdfLinksIn(html: string, base: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+?\.pdf)(?:[?#][^"']*)?["']/gi)) {
    try {
      const u = new URL(m[1]!.replace(/&amp;/g, "&"), base);
      if (/^https?:$/.test(u.protocol)) out.push(u.toString());
    } catch {
      /* neplatná adresa */
    }
  }
  return [...new Set(out)];
}

const SUGGEST_SYSTEM = `Jsi analytik. Z textu měsíčního přehledu kybernetických incidentů NÚKIB vypiš statistiku za měsíc přehledu (poslední sloupec grafů).
Vrať POUZE JSON: {"month":"YYYY-MM","total":počet incidentů,"classes":[{"name":"klasifikace","count":počet}],"severities":[{"name":"závažnost","count":počet}]}.
Celkový počet ber z věty v textu (např. „zaznamenal celkem 26 kybernetických bezpečnostních incidentů“).
Klasifikace pojmenuj podle NÚKIB (Průnik, Pokus o průnik, Dostupnost, Podvod/phishing, Škodlivý kód, Informační bezpečnost, Sběr informací, Zranitelnost, Urážlivý obsah, Ostatní); podíly v procentech přepočti na počty z celku. Zbytek do celku NEPŘIPISUJ do „Ostatní“ ani jinam – chybějící kategorie vynech.
Závažnost: „méně významný“, „významný“, „velmi významný“ kybernetický incident. Pozor: čísla z grafů jsou v textu PDF odtržená od legendy a nemusí být v jejím pořadí. U NÚKIB tvoří naprostou většinu méně významné incidenty, významné jsou jednotky a velmi významné výjimečně – přiřaď hodnoty podle toho a podle celkového počtu.
Neznámé údaje vynech, nic nevymýšlej.`;

export interface InfoServiceDeps {
  fetchImpl?: FetchLike;
  /** Klient AI (OpenAI-kompatibilní / Ollama). */
  aiFetch?: FetchLike;
  /** Text z PDF – výchozí převodní služba (CONVERTER_URL); v testech náhrada. */
  pdfText?: (buf: Uint8Array) => Promise<string>;
}

export function infoServiceRoutes(db: Db, config: Config, deps: InfoServiceDeps = {}) {
  const { fetchImpl } = deps;
  const DECIDED = sql.raw(`(${INFO_DECIDED.map((x) => `'${x}'`).join(", ")})`);
  /** Kanály relevantní pro společnost: bez země, EU, nebo země jejího regulatorního profilu. */
  async function relevantFeeds(c: Parameters<typeof targetCompany>[0], companyId: string, s: Stored) {
    const j = profileOf(await settingsFor(db, c, companyId)).jurisdiction;
    return s.feeds.filter((f) => !f.country || f.country === "EU" || f.country === j).map((f) => f.id);
  }
  const feedCond = (ids: string[]): SQL => (ids.length ? inArray(infoFeedItems.feedId, ids) : sql`false`);
  /** Posouzení položek za společnost včetně aktiv, vazeb a jmen (hromadně). */
  async function assessmentsOf(itemIds: string[], companyId: string): Promise<Map<string, InfoAssessmentDto>> {
    const out = new Map<string, InfoAssessmentDto>();
    if (!itemIds.length) return out;
    const rows = await db
      .select({ r: infoItemReviews, userName: users.displayName, ownerName: positions.name })
      .from(infoItemReviews)
      .leftJoin(users, eq(users.id, infoItemReviews.userId))
      .leftJoin(positions, eq(positions.id, infoItemReviews.ownerPositionId))
      .where(and(inArray(infoItemReviews.itemId, itemIds), eq(infoItemReviews.companyId, companyId)));
    const ids = rows.map((x) => x.r.id);
    const [as, ls] = ids.length
      ? await Promise.all([
          db.select({ aid: infoAssessmentAssets.assessmentId, id: assets.id, name: assets.name }).from(infoAssessmentAssets).innerJoin(assets, eq(assets.id, infoAssessmentAssets.assetId)).where(inArray(infoAssessmentAssets.assessmentId, ids)),
          db.select().from(infoAssessmentLinks).where(inArray(infoAssessmentLinks.assessmentId, ids)),
        ])
      : [[], []];
    const tid = (k: string) => ls.filter((l) => l.kind === k).map((l) => l.targetId);
    const [rl, tl, il] = await Promise.all([
      tid("risk").length ? db.select({ id: risks.id, c: risks.code, n: risks.name }).from(risks).where(inArray(risks.id, tid("risk"))) : [],
      tid("task").length ? db.select({ id: tasks.id, c: sql<string>`'#' || ${tasks.seq}`, n: tasks.title }).from(tasks).where(inArray(tasks.id, tid("task"))) : [],
      tid("incident").length ? db.select({ id: incidents.id, c: incidents.code, n: incidents.title }).from(incidents).where(inArray(incidents.id, tid("incident"))) : [],
    ]);
    const label = new Map([...rl, ...tl, ...il].map((x) => [x.id, `${x.c ? `${x.c} ` : ""}${x.n}`]));
    for (const { r, userName, ownerName } of rows)
      out.set(r.itemId, {
        id: r.id,
        status: r.status as InfoAssessmentStatus,
        note: r.note,
        ownerPositionId: r.ownerPositionId,
        ownerName,
        dueDate: r.dueDate,
        at: r.reviewedAt.toISOString(),
        userName,
        assets: as.filter((a) => a.aid === r.id).map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
        links: ls.filter((l) => l.assessmentId === r.id && label.has(l.targetId)).map((l) => ({ kind: l.kind as InfoLinkKind, targetId: l.targetId, label: label.get(l.targetId)! })),
      });
    return out;
  }
  async function itemOf(id: string) {
    const [item] = await db.select().from(infoFeedItems).where(eq(infoFeedItems.id, id));
    if (!item) throw new HTTPException(404, { message: "Položka nenalezena" });
    return item;
  }
  function writeCompany(c: Parameters<typeof targetCompany>[0], requested?: string | null) {
    const companyId = targetCompany(c, requested);
    if (!hasPermIn(c, "legislation:write", companyId)) throw new HTTPException(403, { message: "Nemáte oprávnění v této společnosti" });
    return companyId;
  }
  /** Posouzení položky za společnost – existující, nebo nové ve stavu „posuzuje se“. */
  async function ensureAssessment(itemId: string, companyId: string, userId: string) {
    await db.insert(infoItemReviews).values({ itemId, companyId, userId, status: "assessing" }).onConflictDoNothing();
    const [r] = await db.select().from(infoItemReviews).where(and(eq(infoItemReviews.itemId, itemId), eq(infoItemReviews.companyId, companyId)));
    return r!;
  }
  const pdfText = deps.pdfText ?? (converterEnabled() ? pdfToText : null);
  /** Povolené hostitele pro stažení přehledu: hostitelé nastavených kanálů RSS. */
  const allowedHosts = async () => new Set((await load(db)).feeds.map((f) => new URL(f.url).host));
  async function fetchBytes(url: string, max: number): Promise<{ buf: Uint8Array; type: string }> {
    const res = await (fetchImpl ?? (fetch as FetchLike))(url, { signal: AbortSignal.timeout(60_000) } as RequestInit);
    if (!res.ok) throw new HTTPException(502, { message: `Stažení přehledu: HTTP ${res.status}` });
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > max) throw new HTTPException(413, { message: "Soubor je větší než 20 MB" });
    return { buf, type: res.headers.get("content-type") ?? "" };
  }
  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "legislation"))
      .get("/", requirePerm("legislation:read"), async (c) => {
        const s = await load(db);
        const companyId = targetCompany(c);
        const open = sql`not exists (select 1 from info_item_reviews r where r.item_id = ${infoFeedItems.id} and r.company_id = ${companyId} and r.status in ${DECIDED})`;
        const [counts] = await db
          .select({
            total: sql<number>`count(*)::int`,
            warningsOpen: sql<number>`count(*) filter (where ${infoFeedItems.kind} = 'warning' and ${open})::int`,
            vulnerabilities30d: sql<number>`count(*) filter (where ${infoFeedItems.kind} = 'vulnerability' and ${infoFeedItems.publishedAt} >= now() - interval '30 days')::int`,
            unreviewed: sql<number>`count(*) filter (where ${open})::int`,
          })
          .from(infoFeedItems)
          .where(feedCond(await relevantFeeds(c, companyId, s)));
        const stats = await db.select().from(infoIncidentStats);
        const rowsOf = (src: string) => stats.filter((r) => r.source === src).map((r) => ({ month: r.month, classification: r.classification, severity: r.severity, count: r.count }));
        const manual = rowsOf(MANUAL);
        const reports = await db
          .select({ id: infoFeedItems.id, title: infoFeedItems.title, link: infoFeedItems.link, publishedAt: infoFeedItems.publishedAt })
          .from(infoFeedItems)
          .where(eq(infoFeedItems.kind, "report"))
          .orderBy(sql`${infoFeedItems.publishedAt} desc nulls last`)
          .limit(24);
        const ai = await getAiSettings(db);
        // Národní MISP – jen stav (modul SOC); adresa bez cesty a parametrů, žádné klíče
        let misp: InfoServiceDto["misp"] = null;
        if (hasPerm(c, "soc:read")) {
          const integ = await loadIntegrations(db);
          let host: string | null = null;
          try {
            host = integ.misp.url ? new URL(integ.misp.url).host : null;
          } catch {
            host = null;
          }
          const ti = await db.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, "soc.threatintel"));
          const lastPull = ((ti[0]?.v as { state?: Record<string, InfoSourceState> } | undefined)?.state?.misp ?? null) as InfoSourceState | null;
          const [mi] = await db.select({ n: sql<number>`count(*)::int` }).from(threatIntel).where(eq(threatIntel.source, "misp"));
          misp = { enabled: integ.misp.enabled, host, pull: integ.misp.pull.enabled, lastPull: lastPull ? { ...lastPull, count: mi?.n ?? lastPull.count } : null, checkOk: integ.misp.check ? integ.misp.check.ok : null };
        }
        return c.json({
          settings: { autoRefresh: s.autoRefresh, intervalHours: s.intervalHours, feeds: s.feeds, opendataEnabled: s.opendataEnabled, opendataUrl: s.opendataUrl },
          state: s.state,
          lastRefreshAt: s.lastRefreshAt,
          counts: counts ?? { total: 0, warningsOpen: 0, vulnerabilities30d: 0, unreviewed: 0 },
          stats: summarizeIncidentStats(mergeIncidentStats(rowsOf(OPENDATA), manual)),
          manualMonths: [...new Set(manual.map((r) => r.month))].sort(),
          reports: reports
            .map((r) => ({ id: r.id, title: r.title, link: r.link, publishedAt: r.publishedAt?.toISOString() ?? null, month: monthFromTitle(r.title) }))
            .filter((r) => r.month || /incident/i.test(r.title)),
          suggestAvailable: ai.enabled && !!pdfText && hasPerm(c, "ai:use"),
          misp,
        } satisfies InfoServiceDto);
      })
      .get(
        "/items",
        requirePerm("legislation:read"),
        zValidator(
          "query",
          z.object({
            kind: z.enum(["warning", "vulnerability", "report", "guidance", "news"]).optional(),
            q: z.string().max(200).optional(),
            unreviewed: z.enum(["1"]).optional(),
            publisher: z.string().max(60).optional(),
            /** `all` = i kanály jiných zemí, než je profil společnosti. */
            scope: z.enum(["all"]).optional(),
            limit: z.coerce.number().int().min(1).max(500).default(100),
          }),
        ),
        async (c) => {
          const q = c.req.valid("query");
          const companyId = targetCompany(c);
          const s = await load(db);
          let feedIds = q.scope === "all" ? s.feeds.map((f) => f.id) : await relevantFeeds(c, companyId, s);
          if (q.publisher) feedIds = feedIds.filter((id) => s.feeds.find((f) => f.id === id)?.publisher === q.publisher);
          const like = q.q ? `%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
          const rows = await db
            .select({ i: infoFeedItems })
            .from(infoFeedItems)
            .where(
              and(
                // položky smazaných kanálů zůstávají jen při „všech zdrojích“
                q.scope === "all" ? undefined : feedCond(feedIds),
                q.scope === "all" && q.publisher ? feedCond(feedIds) : undefined,
                q.kind ? eq(infoFeedItems.kind, q.kind) : undefined,
                like ? or(ilike(infoFeedItems.title, like), ilike(infoFeedItems.summary, like)) : undefined,
                q.unreviewed ? sql`not exists (select 1 from info_item_reviews r where r.item_id = ${infoFeedItems.id} and r.company_id = ${companyId} and r.status in ${DECIDED})` : undefined,
              ),
            )
            .orderBy(sql`${infoFeedItems.publishedAt} desc nulls last`, desc(infoFeedItems.fetchedAt))
            .limit(q.limit);
          const feeds = new Map(s.feeds.map((f) => [f.id, f]));
          const asm = await assessmentsOf(rows.map((r) => r.i.id), companyId);
          return c.json(
            rows.map(({ i }) => {
              const a = asm.get(i.id) ?? null;
              const f = feeds.get(i.feedId);
              return {
                id: i.id,
                feedId: i.feedId,
                feedName: f?.name ?? i.feedId,
                publisher: f?.publisher ?? "",
                country: f?.country ?? "",
                kind: i.kind as FeedItemKind,
                title: i.title,
                link: i.link,
                summary: i.summary,
                category: i.category,
                publishedAt: i.publishedAt?.toISOString() ?? null,
                review: a ? { at: a.at, userName: a.userName, note: a.note } : null,
                assessment: a,
              };
            }) satisfies InfoFeedItemDto[],
          );
        },
      )
      .get("/items/:id", requirePerm("legislation:read"), async (c) => {
        const i = await itemOf(c.req.param("id"));
        const companyId = targetCompany(c);
        const f = (await load(db)).feeds.find((x) => x.id === i.feedId);
        const a = (await assessmentsOf([i.id], companyId)).get(i.id) ?? null;
        return c.json({
          id: i.id,
          feedId: i.feedId,
          feedName: f?.name ?? i.feedId,
          publisher: f?.publisher ?? "",
          country: f?.country ?? "",
          kind: i.kind as FeedItemKind,
          title: i.title,
          link: i.link,
          summary: i.summary,
          category: i.category,
          publishedAt: i.publishedAt?.toISOString() ?? null,
          review: a ? { at: a.at, userName: a.userName, note: a.note } : null,
          assessment: a,
        } satisfies InfoFeedItemDto);
      })
      /** Zjednodušené posouzení (seznámení) – stav „vyřešeno“. */
      .post("/items/:id/review", requirePerm("legislation:write"), zValidator("json", InfoReviewInput), async (c) => {
        const { note, companyId: requested } = c.req.valid("json");
        const companyId = writeCompany(c, requested);
        const item = await itemOf(c.req.param("id"));
        const user = currentUser(c);
        await db
          .insert(infoItemReviews)
          .values({ itemId: item.id, companyId, userId: user.id, note, status: "resolved" })
          .onConflictDoUpdate({ target: [infoItemReviews.itemId, infoItemReviews.companyId], set: { userId: user.id, note, status: "resolved", reviewedAt: new Date() } });
        await audit(db, { c, user, action: "infoservice.reviewed", entityType: "info_item", entityId: item.id, details: { title: item.title, kind: item.kind, companyId, note } });
        return c.json({ ok: true });
      })
      .delete("/items/:id/review", requirePerm("legislation:write"), async (c) => {
        const companyId = writeCompany(c);
        await db.delete(infoItemReviews).where(and(eq(infoItemReviews.itemId, c.req.param("id")), eq(infoItemReviews.companyId, companyId)));
        await audit(db, { c, user: currentUser(c), action: "infoservice.review_removed", entityType: "info_item", entityId: c.req.param("id"), details: { companyId } });
        return c.body(null, 204);
      })
      /** Posouzení dopadu za společnost (ADR-088): stav, závěr, odpovědné místo, termín, dotčená aktiva. */
      .put("/items/:id/assessment", requirePerm("legislation:write"), zValidator("json", InfoAssessmentInput), async (c) => {
        const input = c.req.valid("json");
        const companyId = writeCompany(c, input.companyId);
        const item = await itemOf(c.req.param("id"));
        const user = currentUser(c);
        if (input.assetIds?.length) {
          const ok = await db
            .select({ id: assets.id })
            .from(assets)
            .where(and(inArray(assets.id, input.assetIds), or(inScope(c, assets.companyId), sharedInto(scopeOf(c).ids))));
          if (ok.length !== new Set(input.assetIds).size) throw new HTTPException(400, { message: "Neplatné aktivum." });
        }
        const r = await ensureAssessment(item.id, companyId, user.id);
        await db
          .update(infoItemReviews)
          .set({ status: input.status, note: input.note, ownerPositionId: input.ownerPositionId ?? null, dueDate: input.dueDate ?? null, userId: user.id, reviewedAt: new Date() })
          .where(eq(infoItemReviews.id, r.id));
        if (input.assetIds) {
          await db.delete(infoAssessmentAssets).where(eq(infoAssessmentAssets.assessmentId, r.id));
          const uniq = [...new Set(input.assetIds)];
          if (uniq.length) await db.insert(infoAssessmentAssets).values(uniq.map((assetId) => ({ assessmentId: r.id, assetId })));
        }
        await audit(db, { c, user, action: "infoservice.assessed", entityType: "info_item", entityId: item.id, details: { title: item.title, kind: item.kind, companyId, ...input } });
        return c.json((await assessmentsOf([item.id], companyId)).get(item.id));
      })
      /** Návrh dotčených aktiv: CVE ze zprávy ve zranitelnostech aktiv, produkty v softwaru / OS / výrobci. */
      .get("/items/:id/suggest-assets", requirePerm("legislation:read"), requirePerm("assets:read"), async (c) => {
        const item = await itemOf(c.req.param("id"));
        const text = `${item.title} ${item.summary}`;
        const visible = or(inScope(c, assets.companyId), sharedInto(scopeOf(c).ids))!;
        const out = new Map<string, InfoAssetSuggestion>();
        const add = (rows: { id: string; name: string }[], reason: string) => rows.forEach((r) => out.has(r.id) || out.set(r.id, { ...r, reason }));
        const cves = cveIdsOf(text);
        if (cves.length)
          for (const cve of cves.slice(0, 20))
            add(
              await db.selectDistinct({ id: assets.id, name: assets.name }).from(assetVulnerabilities).innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId)).where(and(visible, eq(assetVulnerabilities.cveId, cve))).limit(50),
              cve,
            );
        for (const term of productTermsOf(text)) {
          const like = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
          add(
            await db.selectDistinct({ id: assets.id, name: assets.name }).from(assetSoftware).innerJoin(assets, eq(assets.id, assetSoftware.assetId)).where(and(visible, ilike(assetSoftware.name, like))).limit(50),
            `software: ${term}`,
          );
          add(
            await db
              .select({ id: assets.id, name: assets.name })
              .from(assets)
              .where(and(visible, or(ilike(assets.osName, like), ilike(assets.manufacturer, like), ilike(assets.model, like), ilike(assets.name, like))))
              .limit(50),
            term,
          );
          if (out.size >= 100) break;
        }
        return c.json([...out.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 100));
      })
      /** Záznam vzniklý z posouzení (riziko, úkol, bezpečnostní událost) – cíl musí patřit téže společnosti. */
      .post("/items/:id/links", requirePerm("legislation:write"), zValidator("json", InfoLinkInput), async (c) => {
        const input = c.req.valid("json");
        const companyId = writeCompany(c, input.companyId);
        const item = await itemOf(c.req.param("id"));
        const tbl = { risk: risks, task: tasks, incident: incidents }[input.kind];
        const [t] = await db.select({ companyId: tbl.companyId }).from(tbl).where(eq(tbl.id, input.targetId));
        if (!t || t.companyId !== companyId) throw new HTTPException(404, { message: "Záznam nenalezen" });
        const r = await ensureAssessment(item.id, companyId, currentUser(c).id);
        // vznik rizika / úkolu / události = položka se organizace týká
        if (r.status === "assessing") await db.update(infoItemReviews).set({ status: "affected" }).where(eq(infoItemReviews.id, r.id));
        await db.insert(infoAssessmentLinks).values({ assessmentId: r.id, kind: input.kind, targetId: input.targetId }).onConflictDoNothing();
        await audit(db, { c, user: currentUser(c), action: "infoservice.linked", entityType: "info_item", entityId: item.id, details: { companyId, ...input } });
        return c.json((await assessmentsOf([item.id], companyId)).get(item.id));
      })
      /** Položky (varování, upozornění), které se týkají aktiva – karta na detailu aktiva. */
      .get("/by-asset/:assetId", requirePerm("legislation:read"), async (c) => {
        const rows = await db
          .select({ id: infoFeedItems.id, title: infoFeedItems.title, kind: infoFeedItems.kind, link: infoFeedItems.link, publishedAt: infoFeedItems.publishedAt, status: infoItemReviews.status, companyId: infoItemReviews.companyId })
          .from(infoAssessmentAssets)
          .innerJoin(infoItemReviews, eq(infoItemReviews.id, infoAssessmentAssets.assessmentId))
          .innerJoin(infoFeedItems, eq(infoFeedItems.id, infoItemReviews.itemId))
          .where(and(eq(infoAssessmentAssets.assetId, c.req.param("assetId")), inScope(c, infoItemReviews.companyId)))
          .orderBy(sql`${infoFeedItems.publishedAt} desc nulls last`)
          .limit(50);
        return c.json(rows.map((r) => ({ ...r, publishedAt: r.publishedAt?.toISOString() ?? null })));
      })
      /** Údaje za měsíc z měsíčního přehledu NÚKIB (nahradí otevřená data téhož měsíce). */
      .get("/stats/manual/:month", requirePerm("legislation:read"), async (c) => {
        const month = c.req.param("month");
        const rows = await db.select().from(infoIncidentStats).where(and(eq(infoIncidentStats.source, MANUAL), eq(infoIncidentStats.month, month)));
        return c.json({
          month,
          classes: rows.filter((r) => r.classification !== ANY).map((r) => ({ name: r.classification, count: r.count })),
          severities: rows.filter((r) => r.severity !== ANY).map((r) => ({ name: r.severity, count: r.count })),
        });
      })
      .put("/stats/manual", requirePerm("legislation:write"), zValidator("json", IncidentMonthInput), async (c) => {
        const input = c.req.valid("json");
        const agg = (xs: { name: string; count: number }[]) => [...xs.reduce((m, x) => m.set(x.name, (m.get(x.name) ?? 0) + x.count), new Map<string, number>()).entries()].filter(([, n]) => n > 0);
        const classes = agg(foldStatItems(input.classes, canonicalClass));
        const severities = agg(foldStatItems(input.severities, canonicalSeverity));
        if (!classes.length && !severities.length) throw new HTTPException(400, { message: "Zadejte počty podle klasifikace nebo závažnosti." });
        await db.transaction(async (tx) => {
          await tx.delete(infoIncidentStats).where(and(eq(infoIncidentStats.source, MANUAL), eq(infoIncidentStats.month, input.month)));
          await tx.insert(infoIncidentStats).values([
            ...classes.map(([classification, count]) => ({ source: MANUAL, month: input.month, classification, severity: ANY, count })),
            ...severities.map(([severity, count]) => ({ source: MANUAL, month: input.month, classification: ANY, severity, count })),
          ]);
        });
        await audit(db, { c, user: currentUser(c), action: "infoservice.stats_saved", details: { ...input } });
        return c.json({ ok: true });
      })
      .delete("/stats/manual/:month", requirePerm("legislation:write"), async (c) => {
        const month = c.req.param("month");
        await db.delete(infoIncidentStats).where(and(eq(infoIncidentStats.source, MANUAL), eq(infoIncidentStats.month, month)));
        await audit(db, { c, user: currentUser(c), action: "infoservice.stats_deleted", details: { month } });
        return c.body(null, 204);
      })
      /**
       * Návrh čísel z měsíčního přehledu (PDF) lokálním / nastaveným modelem AI – nic se neukládá, potvrzuje člověk ve formuláři.
       * Zdroj: položka RSS (stránka aktuality → odkaz na PDF, jen hostitelé nastavených kanálů) nebo nahraný PDF.
       */
      .post("/stats/suggest", requirePerm("legislation:write"), requirePerm("ai:use"), async (c) => {
        const ai = await getAiSettings(db);
        if (!ai.enabled) throw new HTTPException(400, { message: "AI asistent není zapnutý." });
        if (!pdfText) throw new HTTPException(400, { message: "Převodní služba pro PDF není nastavená – čísla doplňte ručně." });
        let pdf: Uint8Array;
        let sourceUrl = "";
        let hint = "";
        let requested: string | null = null;
        const ct = c.req.header("content-type") ?? "";
        if (ct.includes("multipart/form-data")) {
          const body = await c.req.parseBody();
          const file = body.file;
          if (!(file instanceof File)) throw new HTTPException(400, { message: "Vyberte soubor." });
          if (file.size > PDF_MAX) throw new HTTPException(413, { message: "Soubor je větší než 20 MB" });
          pdf = new Uint8Array(await file.arrayBuffer());
          hint = file.name;
        } else {
          const parsed = z
            .object({ itemId: z.string().uuid().optional(), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() })
            .refine((x) => !!x.itemId !== !!x.month)
            .safeParse(await c.req.json().catch(() => ({})));
          if (!parsed.success) throw new HTTPException(400, { message: "Vyberte přehled nebo soubor PDF." });
          const hosts = await allowedHosts();
          const ok = (u: string) => {
            try {
              const x = new URL(u);
              return x.protocol === "https:" && hosts.has(x.host);
            } catch {
              return false;
            }
          };
          const { itemId, month: wanted } = parsed.data;
          requested = wanted ?? null;
          // starší měsíc bez položky v RSS: přehled se dohledá podle zvyklostí pojmenování souborů NÚKIB
          let found: { url: string; buf: Uint8Array } | null = null;
          if (wanted) {
            for (const u of nukibReportUrls(wanted).filter(ok)) {
              try {
                const r = await fetchBytes(u, PDF_MAX);
                if (r.buf[0] === 0x25 && r.buf[1] === 0x50) {
                  found = { url: u, buf: r.buf };
                  break;
                }
              } catch {
                /* další varianta názvu */
              }
            }
            if (!found) throw new HTTPException(404, { message: "Přehled za zvolený měsíc se na webu NÚKIB nepodařilo najít – nahrajte PDF ručně." });
          }
          const [item] = itemId ? await db.select().from(infoFeedItems).where(eq(infoFeedItems.id, itemId)) : [];
          if (found) {
            pdf = found.buf;
            sourceUrl = found.url;
            hint = `přehled za ${wanted} ${found.url.split("/").pop() ?? ""}`;
          } else {
          if (!item?.link) throw new HTTPException(404, { message: "Položka nenalezena" });
          if (!ok(item.link)) throw new HTTPException(400, { message: "Odkaz nevede na hostitele nastaveného kanálu RSS." });
          hint = item.title;
          let url = item.link;
          let r = await fetchBytes(url, PDF_MAX);
          if (!r.type.includes("pdf") && !/\.pdf$/i.test(url)) {
            const links = pdfLinksIn(new TextDecoder().decode(r.buf), url).filter(ok);
            const pick = links.find((l) => /incident/i.test(l)) ?? links[0];
            if (!pick) throw new HTTPException(400, { message: "Na stránce aktuality není odkaz na PDF přehledu." });
            url = pick;
            r = await fetchBytes(url, PDF_MAX);
          }
          pdf = r.buf;
          sourceUrl = url;
          hint = `${hint} ${url.split("/").pop() ?? ""}`;
          }
        }
        if (!(pdf[0] === 0x25 && pdf[1] === 0x50 && pdf[2] === 0x44 && pdf[3] === 0x46)) throw new HTTPException(400, { message: "Soubor není PDF." });
        const text = (await pdfText(pdf).catch((e) => {
          throw new HTTPException(502, { message: `Převod PDF: ${(e as Error).message}`.slice(0, 300) });
        })).replace(/\s+\n/g, "\n").slice(0, 20_000);
        if (!text.trim()) throw new HTTPException(400, { message: "Z PDF se nepodařilo získat text." });
        const t0 = Date.now();
        let reply: string;
        let model: string;
        try {
          const r = await clientFor(ai, config, deps.aiFetch).chat([
            { role: "system", content: SUGGEST_SYSTEM },
            { role: "user", content: `Název / soubor: ${hint}\n\nText přehledu:\n${text}` },
          ]);
          reply = r.text;
          model = r.model ?? ai.model;
        } catch (e) {
          throw new HTTPException(502, { message: `AI: ${(e as Error).message}`.slice(0, 300) });
        }
        let proposal: IncidentStatsProposal;
        try {
          proposal = parseIncidentStatsProposal(reply);
        } catch (e) {
          throw new HTTPException(502, { message: `AI: ${(e as Error).message}` });
        }
        if (requested && proposal.month && proposal.month !== requested) proposal.warnings.push(`Model uvádí měsíc ${proposal.month}, přehled byl hledán pro ${requested} – ověřte.`);
        const month = requested ?? proposal.month ?? monthFromTitle(hint);
        if (!proposal.month && month) proposal.warnings = proposal.warnings.filter((w) => !w.startsWith("Měsíc"));
        await audit(db, { c, user: currentUser(c), action: "infoservice.stats_suggested", details: { sourceUrl: sourceUrl || hint, model, durationMs: Date.now() - t0, month, total: proposal.total } });
        return c.json({ ...proposal, month, sourceUrl, model });
      })
      .put("/settings", requirePerm("admin:settings"), zValidator("json", InfoServiceSettingsInput), async (c) => {
        const input = c.req.valid("json");
        if (new Set(input.feeds.map((f) => f.id)).size !== input.feeds.length) throw new HTTPException(400, { message: "Zdroje musí mít různé klíče." });
        await save(db, input);
        await audit(db, { c, user: currentUser(c), action: "infoservice.settings_updated", details: input });
        return c.json({ ok: true });
      })
      .post("/refresh", requirePerm("legislation:write"), async (c) => {
        const state = await refreshInfoService(db, fetchImpl);
        await audit(db, { c, user: currentUser(c), action: "infoservice.refreshed", details: { state } });
        return c.json({ state });
      })
      /** Ruční nahrání (server bez internetu): `source` = klíč zdroje RSS, nebo `opendata`. */
      .post("/upload", requirePerm("admin:settings"), async (c) => {
        const body = await c.req.parseBody();
        const file = body.file;
        const source = typeof body.source === "string" ? body.source : "";
        if (!(file instanceof File)) throw new HTTPException(400, { message: "Vyberte soubor." });
        if (file.size > MAX_BYTES) throw new HTTPException(413, { message: "Soubor je větší než 10 MB" });
        const s = await load(db);
        const text = new TextDecoder().decode(new Uint8Array(await file.arrayBuffer()));
        let n: number;
        try {
          if (source === "opendata") n = await storeOpendata(db, text);
          else if (s.feeds.some((f) => f.id === source)) n = await storeFeedItems(db, source, text, s.feeds.find((f) => f.id === source));
          else throw new HTTPException(400, { message: "Neznámý zdroj." });
        } catch (e) {
          if (e instanceof HTTPException) throw e;
          throw new HTTPException(400, { message: (e as Error).message });
        }
        const key = source === "opendata" ? OPENDATA : source;
        await save(db, { state: { ...s.state, [key]: { at: new Date().toISOString(), count: n, error: null } } });
        await audit(db, { c, user: currentUser(c), action: "infoservice.uploaded", details: { source, file: file.name, count: n } });
        return c.json({ count: n });
      })
  );
}

/** Varování a upozornění na zranitelnosti za období s výsledkem posouzení společnosti – vstup zprávy o rizicích a přezkumu (ADR-088). */
export async function infoItemsForReport(db: Db, companyId: string, from?: string | null, to?: string | null) {
  const since = from ? new Date(from) : new Date(Date.now() - 365 * 864e5);
  const until = to ? new Date(`${to}T23:59:59Z`) : new Date();
  const rows = await db
    .select({ id: infoFeedItems.id, title: infoFeedItems.title, kind: infoFeedItems.kind, publishedAt: infoFeedItems.publishedAt, aid: infoItemReviews.id, status: infoItemReviews.status, note: infoItemReviews.note })
    .from(infoFeedItems)
    .leftJoin(infoItemReviews, and(eq(infoItemReviews.itemId, infoFeedItems.id), eq(infoItemReviews.companyId, companyId)))
    .where(and(inArray(infoFeedItems.kind, ["warning", "vulnerability"]), sql`${infoFeedItems.publishedAt} >= ${since.toISOString()}`, sql`${infoFeedItems.publishedAt} <= ${until.toISOString()}`))
    .orderBy(desc(infoFeedItems.publishedAt))
    .limit(100);
  const aids = rows.map((r) => r.aid).filter((x): x is string => !!x);
  const counts = aids.length
    ? await db.select({ aid: infoAssessmentAssets.assessmentId, n: sql<number>`count(*)::int` }).from(infoAssessmentAssets).where(inArray(infoAssessmentAssets.assessmentId, aids)).groupBy(infoAssessmentAssets.assessmentId)
    : [];
  const n = new Map(counts.map((x) => [x.aid, x.n]));
  return rows.map((r) => ({ title: r.title, kind: r.kind, publishedAt: r.publishedAt?.toISOString() ?? null, status: (r.status ?? null) as InfoAssessmentStatus | null, note: r.note ?? "", assets: r.aid ? (n.get(r.aid) ?? 0) : 0 }));
}
export type InfoReportItem = Awaited<ReturnType<typeof infoItemsForReport>>[number];
