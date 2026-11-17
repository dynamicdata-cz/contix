import {
  SCENARIO_TEMPLATES,
  THREAT_ACTORS,
  actorRelevance,
  sectorDelta,
  type ActorRelevanceDto,
  type DetectionDto,
  type Sector,
  type ThreatLandscapeDto,
} from "@contix/shared";
import { and, eq, gte, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { alertSuggestions, infoFeedItems, threatIntel, threatProfiles, users } from "../../db/schema";

/* ============================================================
 * Aktéři hrozeb pro odvětví (v1.40, ADR-137): katalog THREAT_ACTORS + doložené signály
 * (zmínky v informačním servisu NÚKIB / CERT za 180 dní, indikátory MISP / TI se jménem aktéra za 90 dní,
 * alerty SOC s technikami aktéra za 90 dní). Jen čte; ruční rozhodnutí o relevanci ukládá člověk se zdůvodněním.
 * ============================================================ */

const day = 86_400_000;
const norm = (s: string) => s.toLowerCase();
/** Celé slovo / jméno (alias „Play“ nesmí chytit „display“). */
const mentions = (text: string, alias: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${alias.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u").test(text);

export async function threatProfile(db: Db, companyId: string) {
  const [p] = await db.select({ p: threatProfiles, by: users.displayName }).from(threatProfiles).leftJoin(users, eq(users.id, threatProfiles.updatedById)).where(eq(threatProfiles.companyId, companyId));
  const empty: Record<string, { relevant: boolean; reason: string }> = {};
  return p ? { sector: (p.p.sector as Sector | null) ?? null, overrides: p.p.overrides ?? empty, updatedAt: p.p.updatedAt.toISOString(), updatedByName: p.by } : { sector: null, overrides: empty, updatedAt: null, updatedByName: null };
}

export async function threatLandscape(db: Db, companyId: string, det?: DetectionDto | null, now = new Date()): Promise<ThreatLandscapeDto> {
  const prof = await threatProfile(db, companyId);
  const feed = await db
    .select({ title: infoFeedItems.title, summary: infoFeedItems.summary, category: infoFeedItems.category, link: infoFeedItems.link, at: infoFeedItems.publishedAt, feed: infoFeedItems.feedId })
    .from(infoFeedItems)
    .where(gte(sql`coalesce(${infoFeedItems.publishedAt}, ${infoFeedItems.fetchedAt})`, sql`${new Date(now.getTime() - 180 * day).toISOString()}::timestamptz`));
  const intel = await db
    .select({ threat: threatIntel.threat, n: sql<number>`count(*)::int` })
    .from(threatIntel)
    .where(and(sql`${threatIntel.threat} is not null`, gte(threatIntel.fetchedAt, new Date(now.getTime() - 90 * day))))
    .groupBy(threatIntel.threat);
  const alerts = await db
    .select({ mitre: alertSuggestions.mitreIds })
    .from(alertSuggestions)
    .where(and(eq(alertSuggestions.companyId, companyId), gte(alertSuggestions.lastSeen, new Date(now.getTime() - 90 * day)), ne(alertSuggestions.status, "dismissed"), or(isNull(alertSuggestions.verdict), ne(alertSuggestions.verdict, "false_positive"))));
  const actors: ActorRelevanceDto[] = THREAT_ACTORS.map((a) => {
    const al = a.aliases.map(norm);
    const m = feed.filter((f) => al.some((x) => mentions(norm(`${f.title} ${f.summary} ${f.category}`), x)));
    const signals = {
      mentions: m
        .sort((x, y) => (y.at?.getTime() ?? 0) - (x.at?.getTime() ?? 0))
        .slice(0, 5)
        .map((f) => ({ title: f.title, link: f.link, at: f.at?.toISOString() ?? null, feed: f.feed })),
      intel: intel.filter((i) => i.threat && al.some((x) => mentions(norm(i.threat!), x))).reduce((s, i) => s + i.n, 0),
      alerts: alerts.filter((x) => x.mitre.some((t) => a.techniques.some((k) => t === k || t.startsWith(`${k}.`)))).length,
    };
    // počet zmínek se počítá ze všech (výpis jen 5 nejnovějších)
    const r = actorRelevance(a, prof.sector, { ...signals, mentions: m.map(() => ({ title: "", link: "", at: null, feed: "" })) }, prof.overrides[a.key] ?? null);
    return { key: a.key, name: a.name, aliases: a.aliases, motivation: a.motivation, origin: a.origin, techniques: a.techniques, signals, ...r };
  }).sort((x, y) => ({ high: 0, medium: 1, low: 2 })[x.relevance] - ({ high: 0, medium: 1, low: 2 })[y.relevance] || y.score - x.score);
  const templates = SCENARIO_TEMPLATES.map((t) => ({ key: t.key, ...sectorDelta(t.attack, actors, !!prof.sector) }));
  const relevant = actors.filter((a) => a.relevance !== "low");
  const tech = new Map<string, string[]>();
  for (const a of relevant) for (const t of a.techniques) tech.set(t, [...(tech.get(t) ?? []), a.name]);
  const detState = (id: string): ThreatLandscapeDto["techniques"][number]["detection"] => {
    if (!det?.measured) return "unknown";
    const s = det.techniques.find((x) => x.id === id)?.state;
    return !s ? "unknown" : s === "blind" ? "blind" : s === "declared" ? "partial" : "covered";
  };
  return {
    sector: prof.sector,
    updatedAt: prof.updatedAt,
    updatedByName: prof.updatedByName,
    actors,
    templates,
    techniques: [...tech.entries()].sort((a, b) => b[1].length - a[1].length).map(([id, list]) => ({ id, actors: list, detection: detState(id) })),
  };
}
