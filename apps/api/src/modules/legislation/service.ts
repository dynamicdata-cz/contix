import { profileOf, ACT_FRAMEWORK,
  diffFragments,
  EU_SUGGESTED,
  parseEuStaleUrl,
  legalReviewDue,
  requirementById,
  requirementsForFragment,
  splitManualText,
  type DiffPart,
  type FrameworkId,
  type LegalAffected,
  type LegalDiffItem,
  type LegalFragmentDto,
} from "@contix/shared";
import { createHash } from "node:crypto";
import { diffWordsWithSpace } from "diff";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { getSettings } from "../../auth/service";
import { settingsFor } from "../../auth/scope";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import {
  controlRequirements,
  controls,
  legalActs,
  legalChanges,
  legalFragments,
  legalReviews,
  legalVersions,
  legalWatch,
  policies,
  policyRequirements,
} from "../../db/schema";
import { ESBIRKA_SCHEMA_VERSION, EsbirkaClient, type FetchLike, type SourceFragment } from "./esbirka";
import { fetchRssChanges, type RssChange } from "./opendata";
import { eurlexEnabled, legalSourceKind, sourceForAct, withTextMode } from "./source";

/* ============================================================
 * Legislativa (ADR-035): stažení znění, uložení verze a fragmentů, detekce změny (rozdíl po fragmentech),
 * založení posouzení dopadu pro sledující společnosti, dohledání dotčených požadavků / opatření / dokumentů.
 * ============================================================ */

type ActRow = typeof legalActs.$inferSelect;
const running = new Set<string>();

const hashOf = (frags: { key: string; text: string }[]) =>
  createHash("sha256")
    .update(JSON.stringify(frags.map((f) => [f.key, f.text.replace(/\s+/g, " ").trim()])))
    .digest("hex");

export async function fragmentsOf(db: Db, versionId: string): Promise<LegalFragmentDto[]> {
  return db
    .select({ key: legalFragments.key, label: legalFragments.label, text: legalFragments.text, depth: legalFragments.depth, kind: legalFragments.kind })
    .from(legalFragments)
    .where(eq(legalFragments.versionId, versionId))
    .orderBy(asc(legalFragments.position));
}

/**
 * Uloží nové znění (pokud se obsah liší od aktuálního), spočítá rozdíl a založí posouzení pro sledující společnosti.
 * Vrací id změny (null = beze změny obsahu nebo první znění).
 */
export async function storeVersion(
  db: Db,
  act: ActRow,
  v: { versionKey: string; effectiveFrom: string | null; sourceUrl: string | null; meta: Record<string, unknown> | null; fragments: (SourceFragment | LegalFragmentDto)[] },
  now = new Date(),
  opts: { textSource?: string | null; baseline?: (SourceFragment | LegalFragmentDto)[] } = {},
): Promise<{ versionId: string | null; changeId: string | null }> {
  const hash = hashOf(v.fragments);
  const cur = act.currentVersionId ? (await db.select().from(legalVersions).where(eq(legalVersions.id, act.currentVersionId)))[0] : undefined;
  if (cur && cur.contentHash === hash) return { versionId: null, changeId: null };
  const [ver] = await db
    .insert(legalVersions)
    .values({ actId: act.id, versionKey: v.versionKey, effectiveFrom: v.effectiveFrom, sourceUrl: v.sourceUrl, contentHash: hash, fragmentCount: v.fragments.length, schemaVersion: ESBIRKA_SCHEMA_VERSION, meta: v.meta, fetchedAt: now })
    .onConflictDoNothing()
    .returning();
  if (!ver) return { versionId: null, changeId: null };
  for (let i = 0; i < v.fragments.length; i += 500)
    await db.insert(legalFragments).values(
      v.fragments.slice(i, i + 500).map((f, j) => ({
        versionId: ver.id,
        key: f.key.slice(0, 200),
        label: f.label.slice(0, 500),
        text: f.text,
        depth: f.depth,
        kind: f.kind.slice(0, 60),
        position: i + j,
        sourceId: "sourceId" in f ? f.sourceId : null,
      })),
    );
  await db.update(legalActs).set({ currentVersionId: ver.id, updatedAt: now }).where(eq(legalActs.id, act.id));
  if (!cur) return { versionId: ver.id, changeId: null };
  // stejné znění, jen z jiného zdroje (otevřená data ↔ web e-Sbírky ↔ REST API) – text se nahradí bez změny a posouzení (v1.13.2)
  if (opts.textSource && cur.versionKey === v.versionKey && versionSource(act, cur.meta) !== opts.textSource) return { versionId: ver.id, changeId: null };
  const diff = diffFragments((opts.baseline as LegalFragmentDto[] | undefined) ?? (await fragmentsOf(db, cur.id)), v.fragments as LegalFragmentDto[]);
  if (!diff.length) return { versionId: ver.id, changeId: null };
  const [ch] = await db
    .insert(legalChanges)
    .values({
      actId: act.id,
      fromVersionId: cur.id,
      toVersionId: ver.id,
      detectedAt: now,
      added: diff.filter((d) => d.kind === "added").length,
      removed: diff.filter((d) => d.kind === "removed").length,
      modified: diff.filter((d) => d.kind === "modified").length,
    })
    .returning();
  const watchers = await db.select().from(legalWatch).where(eq(legalWatch.actId, act.id));
  if (watchers.length)
    await db
      .insert(legalReviews)
      .values(watchers.map((w) => ({ companyId: w.companyId, changeId: ch!.id, ownerPositionId: w.ownerPositionId, dueDate: legalReviewDue(now.toISOString()) })))
      .onConflictDoNothing();
  return { versionId: ver.id, changeId: ch!.id };
}

/** Synchronizace předpisu z e-Sbírky nebo EUR-Lex. `force` = stáhnout fragmenty i při stejném označení znění. */
export async function syncAct(db: Db, config: Config, actId: string, opts: { force?: boolean; fetchImpl?: FetchLike; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const [act] = await db.select().from(legalActs).where(eq(legalActs.id, actId));
  if (!act) throw new Error("Předpis nenalezen.");
  if ((act.source !== "esbirka" && act.source !== "eurlex") || !act.staleUrl) return { changeId: null, versionId: null };
  if (running.has(actId)) throw new Error("Synchronizace předpisu už probíhá.");
  running.add(actId);
  try {
    const client = sourceForAct(act.source, await effectiveLegalConfig(db, config), opts.fetchImpl);
    const meta = await client.current(act.staleUrl);
    const cur = act.currentVersionId ? (await db.select().from(legalVersions).where(eq(legalVersions.id, act.currentVersionId)))[0] : undefined;
    // stejné znění: obsah se stahuje znovu jen při vynucení nebo jednou týdně (opravy textu bez nového znění)
    const recent = cur && now.getTime() - cur.fetchedAt.getTime() < 7 * 86_400_000;
    let result: { versionId: string | null; changeId: string | null } = { versionId: null, changeId: null };
    let pending: string | null = null;
    let textSource: string | null = null;
    // čekáme na text novějšího znění → kontrolovat při každém běhu (ne jednou týdně)
    const waiting = !!(act.lastStatus === "ok" && act.lastError);
    if (!cur || cur.versionKey !== meta.versionKey || opts.force || !recent || waiting) {
      let fragments = await client.fragments(meta.versionKey);
      const diag = (client as { lastDiagnostic?: string | null }).lastDiagnostic;
      if (!fragments.length) {
        // nejnovější (často budoucí) znění ještě nemá v datech zdroje text → uložit / ponechat nejbližší starší znění
        // a zkoušet znovu při každé kontrole (v1.12.2); REST API zkusí stálou URL předpisu
        const alts: { versionKey: string; from: string | null }[] = Array.isArray(meta.meta.candidates) ? (meta.meta.candidates as { versionKey: string; from: string | null }[]) : [];
        if (client instanceof EsbirkaClient && meta.versionKey !== act.staleUrl) alts.push({ versionKey: act.staleUrl, from: meta.effectiveFrom });
        for (const alt of alts.filter((x) => x.versionKey !== meta.versionKey).slice(0, 3)) {
          const f = await client.fragments(alt.versionKey);
          if (!f.length) continue;
          fragments = f;
          pending = `Nejnovější znění ${meta.versionKey}${meta.effectiveFrom ? ` (účinné od ${meta.effectiveFrom})` : ""} zatím nemá ve zdroji text – sleduje se znění ${alt.versionKey}; kontrola se zopakuje.`;
          if (alt.versionKey !== act.staleUrl) {
            meta.versionKey = alt.versionKey;
            meta.effectiveFrom = alt.from;
          }
          break;
        }
      }
      const src = act.source === "eurlex" ? "EUR-Lex" : "e-Sbírka";
      if (!fragments.length) throw new Error(`${src}: zdroj nevrátil text předpisu – možná změna struktury dat rozhraní (ověřte konektor).${diag ? ` [${diag}]` : ""}`);
      // změna struktury zdroje: drtivá většina klíčů se nedá odvodit z citace → raději nic nezapisovat
      const generic = fragments.filter((f) => f.key.startsWith("frag_")).length;
      if (generic > fragments.length * 0.5) throw new Error(`Nepodařilo se určit citace fragmentů (změna struktury dat zdroje ${src}?) – znění nebylo uloženo.`);
      textSource = textSourceOf(act, client);
      // jiný zdroj textu než u uloženého znění: rozdíl počítat proti staršímu znění ze stejného zdroje (bez šumu formátování)
      let baseline: SourceFragment[] | undefined;
      if (cur && versionSource(act, cur.meta) !== textSource && cur.versionKey !== meta.versionKey && !cur.versionKey.endsWith("/0000-00-00")) {
        const old = await client.fragments(cur.versionKey).catch(() => []);
        if (old.length && textSourceOf(act, client) === textSource) baseline = old;
      }
      result = await storeVersion(db, act, { versionKey: meta.versionKey, effectiveFrom: meta.effectiveFrom, sourceUrl: meta.sourceUrl, meta: { ...meta.meta, textSource }, fragments }, now, { textSource, baseline });
    }
    await db
      .update(legalActs)
      .set({ code: meta.code?.slice(0, 100) ?? act.code, title: keepTitle(act) ? act.title : (meta.title?.slice(0, 500) ?? act.title), meta: { ...meta.meta, rss: (act.meta as { rss?: unknown } | null)?.rss ?? null, ...textSourceMeta(act, textSource, now) }, lastCheckedAt: now, lastStatus: "ok", lastError: pending, updatedAt: now })
      .where(eq(legalActs.id, act.id));
    return result;
  } catch (e) {
    await db.update(legalActs).set({ lastCheckedAt: now, lastStatus: "error", lastError: (e as Error).message.slice(0, 1000) }).where(eq(legalActs.id, act.id));
    throw e;
  } finally {
    running.delete(actId);
  }
}

/** Konfigurace zdroje Sbírky podle volby v administraci (`settings.legalTextSource`). */
export async function effectiveLegalConfig<T extends Config>(db: Db, config: T): Promise<T> {
  return withTextMode(config, (await getSettings(db)).legalTextSource);
}
/** Odkud pochází text znění: eurlex / api / opendata / web. */
function textSourceOf(act: ActRow, client: unknown): string {
  if (act.source === "eurlex") return "eurlex";
  if (client instanceof EsbirkaClient) return "api";
  return (client as { lastSource?: string | null }).lastSource ?? "opendata";
}
/** Zdroj uloženého znění (starší znění bez `textSource`: otevřená data podle `source`, jinak REST API / EUR-Lex). */
export function versionSource(act: Pick<ActRow, "source">, meta: unknown): string {
  const m = (meta ?? {}) as { textSource?: string; source?: string };
  return m.textSource ?? (m.source === "opendata" ? "opendata" : act.source === "eurlex" ? "eurlex" : "api");
}
/** Zdroj textu u předpisu a od kdy se čte ze zálohy (web) – pro upozornění v Provozu. */
function textSourceMeta(act: ActRow, textSource: string | null, now: Date) {
  const prev = (act.meta ?? {}) as { textSource?: string; webSince?: string };
  const src = textSource ?? prev.textSource ?? null;
  return { textSource: src, webSince: src === "web" ? (prev.textSource === "web" && prev.webSince ? prev.webSince : now.toISOString()) : null };
}

/** Doporučený předpis EU v češtině si ponechá krátký srozumitelný název (úřední název bývá velmi dlouhý). */
const keepTitle = (act: ActRow) => {
  const eu = parseEuStaleUrl(act.staleUrl);
  return act.source === "eurlex" && eu?.lang === "cs" && EU_SUGGESTED.some((s) => s.celex === eu.celex);
};

/** Ruční znění (norma, licencovaný text) – rozdělí text na fragmenty podle nadpisů. */
export async function addManualVersion(db: Db, act: ActRow, v: { label: string; effectiveFrom: string | null; text: string }, now = new Date()) {
  const fragments = splitManualText(v.text);
  if (!fragments.length) throw new Error("Text neobsahuje žádný obsah.");
  const r = await storeVersion(db, act, { versionKey: v.label, effectiveFrom: v.effectiveFrom, sourceUrl: null, meta: null, fragments }, now);
  await db.update(legalActs).set({ lastCheckedAt: now, lastStatus: "ok", lastError: null }).where(eq(legalActs.id, act.id));
  return r;
}

/**
 * Plánovač: předpisy z e-Sbírky, které někdo sleduje, se kontrolují jednou denně; RSS „Změny v e-Sbírce“ navíc
 * spustí kontrolu hned po zveřejnění nového znění a zaznamená nastavené datum zrušení předpisu.
 */
export async function processLegislationSync(db: Db, config: Config, now = new Date(), fetchImpl?: FetchLike): Promise<string[]> {
  if (!((await getSettings(db)).enabledModules as string[]).includes("legislation")) return [];
  const eff = await effectiveLegalConfig(db, config);
  const sources = [...(legalSourceKind(eff) !== "off" ? (["esbirka"] as const) : []), ...(eurlexEnabled(eff) ? (["eurlex"] as const) : [])];
  if (!sources.length) return [];
  const acts = await db
    .selectDistinct({ id: legalActs.id, code: legalActs.code, source: legalActs.source, staleUrl: legalActs.staleUrl, last: legalActs.lastCheckedAt, meta: legalActs.meta })
    .from(legalActs)
    .innerJoin(legalWatch, eq(legalWatch.actId, legalActs.id))
    .where(inArray(legalActs.source, sources));
  if (!acts.length) return [];
  const errors: string[] = [];
  let rss: RssChange[] = [];
  if (acts.some((a) => a.source === "esbirka"))
    try {
      rss = await fetchRssChanges(config, fetchImpl);
    } catch (e) {
      errors.push(`RSS: ${(e as Error).message}`);
    }
  for (const a of acts) {
    // předpisy EU: jednou denně (CELLAR nemá veřejný kanál změn pro jednotlivé akty)
    if (a.source === "eurlex") {
      if (a.last && now.getTime() - a.last.getTime() < 23 * 3_600_000) continue;
      await syncAct(db, config, a.id, { now, fetchImpl }).catch((e) => errors.push(`${a.code}: ${(e as Error).message}`));
      continue;
    }
    const items = rss.filter((r) => r.staleUrl === a.staleUrl);
    const prev = ((a.meta as { rss?: { repeal?: unknown; lastItem?: string } } | null)?.rss ?? {}) as { repeal?: unknown; lastItem?: string };
    const repeal = items.find((r) => r.kind === "repeal");
    const newest = items.map((r) => r.published ?? "").sort().at(-1) ?? "";
    if (items.length)
      await db
        .update(legalActs)
        .set({ meta: { ...((a.meta as object | null) ?? {}), rss: { ...prev, ...(repeal ? { repeal: { date: repeal.date, title: repeal.title, published: repeal.published } } : {}), lastItem: newest > (prev.lastItem ?? "") ? newest : prev.lastItem } } })
        .where(eq(legalActs.id, a.id));
    const announced = items.some((r) => r.kind === "version" && r.published && (!a.last || new Date(r.published) > a.last));
    if (!announced && a.last && now.getTime() - a.last.getTime() < 23 * 3_600_000) continue;
    await syncAct(db, config, a.id, { now, fetchImpl }).catch((e) => errors.push(`${a.code}: ${(e as Error).message}`));
  }
  return errors;
}

/** Rozdíl změny s rozpadem po slovech a dotčenými požadavky. */
export async function changeDiff(db: Db, change: typeof legalChanges.$inferSelect, act: ActRow): Promise<LegalDiffItem[]> {
  const [before, after] = await Promise.all([change.fromVersionId ? fragmentsOf(db, change.fromVersionId) : Promise.resolve([]), fragmentsOf(db, change.toVersionId)]);
  const fw = frameworkOf(act);
  return diffFragments(before, after).map((d) => ({
    ...d,
    parts: d.kind === "modified" ? diffWordsWithSpace(d.before!, d.after!).map((p): DiffPart => ({ t: p.added ? "+" : p.removed ? "-" : "=", v: p.value })) : undefined,
    requirementIds: fw ? requirementsForFragment(fw, d.key) : [],
  }));
}

export const frameworkOf = (act: Pick<ActRow, "frameworkId" | "staleUrl">): FrameworkId | null =>
  ((act.frameworkId as FrameworkId | null) ?? (act.staleUrl ? ACT_FRAMEWORK[act.staleUrl] : undefined)) ?? null;

/** Dotčené požadavky CONTIX, opatření a dokumenty společnosti. */
export async function affectedOf(db: Db, companyId: string, act: ActRow, diff: LegalDiffItem[]): Promise<LegalAffected> {
  const byReq = new Map<string, string[]>();
  for (const d of diff) for (const id of d.requirementIds ?? []) byReq.set(id, [...(byReq.get(id) ?? []), d.key]);
  const reqIds = [...byReq.keys()];
  const requirements = reqIds
    .map((id) => requirementById(id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => ({ id: r.id, ref: r.ref, text: r.text, framework: r.framework, fragmentKeys: byReq.get(r.id) ?? [] }));
  if (!reqIds.length) return { requirements, controls: [], policies: [] };
  const fw = frameworkOf(act);
  const settings = await settingsFor(db, null, companyId);
  const decree = profileOf(settings).defaultFramework;
  const sections = [...new Set(requirements.map((r) => requirementById(r.id)!.section))];
  const [ctl, linkedDocs, sectionDocs] = await Promise.all([
    db
      .selectDistinct({ id: controls.id, code: controls.code, name: controls.name })
      .from(controlRequirements)
      .innerJoin(controls, eq(controls.id, controlRequirements.controlId))
      .where(and(eq(controls.companyId, companyId), inArray(controlRequirements.requirementId, reqIds))),
    db
      .select({ id: policies.id, code: policies.code, title: policies.title, req: policyRequirements.requirementId })
      .from(policyRequirements)
      .innerJoin(policies, eq(policies.id, policyRequirements.policyId))
      .where(and(eq(policies.companyId, companyId), inArray(policyRequirements.requirementId, reqIds))),
    // oddíly vyhlášky u bezpečnostní dokumentace – jen vyhláška odpovídající režimu společnosti
    fw === decree
      ? db
          .select({ id: policies.id, code: policies.code, title: policies.title, sections: policies.sections })
          .from(policies)
          .where(and(eq(policies.companyId, companyId), eq(policies.system, "isms"), sql`${policies.sections} && ARRAY[${sql.join(sections.map((x) => sql`${x}`), sql`, `)}]::text[]`))
      : Promise.resolve([] as { id: string; code: string | null; title: string; sections: string[] }[]),
  ]);
  const docs = new Map<string, { id: string; code: string | null; title: string; via: string }>();
  for (const d of linkedDocs) docs.set(d.id, { id: d.id, code: d.code, title: d.title, via: `požadavek ${requirementById(d.req)?.ref ?? d.req}` });
  for (const d of sectionDocs) if (!docs.has(d.id)) docs.set(d.id, { id: d.id, code: d.code, title: d.title, via: `oddíl ${d.sections.filter((s) => sections.includes(s)).join(", ")}` });
  return { requirements, controls: ctl, policies: [...docs.values()].sort((a, b) => (a.code ?? "").localeCompare(b.code ?? "", "cs", { numeric: true })) };
}

/** Stav pro Provoz. */
export async function legislationStatus(db: Db, config: Config, now = new Date()) {
  const acts = await db
    .selectDistinct({ id: legalActs.id, code: legalActs.code, status: legalActs.lastStatus, error: legalActs.lastError, last: legalActs.lastCheckedAt, meta: legalActs.meta })
    .from(legalActs)
    .innerJoin(legalWatch, eq(legalWatch.actId, legalActs.id))
    .where(and(inArray(legalActs.source, ["esbirka", "eurlex"]), isNotNull(legalActs.staleUrl)));
  const cfg = await effectiveLegalConfig(db, config);
  const mode = (await getSettings(db)).legalTextSource;
  // záloha z webu e-Sbírky déle než týden v režimu „automaticky“ = otevřená data nefungují
  const fallback = mode === "auto" ? acts.filter((a) => { const m = (a.meta ?? {}) as { webSince?: string }; return !!m.webSince && now.getTime() - new Date(m.webSince).getTime() > 7 * 86_400_000; }) : [];
  return { configured: legalSourceKind(cfg) !== "off", source: legalSourceKind(cfg), mode, eurlex: eurlexEnabled(cfg), acts, stale: acts.filter((a) => !a.last || now.getTime() - a.last.getTime() > 50 * 3_600_000), fallback };
}

