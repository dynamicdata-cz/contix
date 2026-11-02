import { EXCEPTION_KINDS, RECORD_KINDS, RecordIndexSettingsInput, RECORD_LABELS, type Permission, type RecordAskAnswer, type RecordKind, type Translate } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { currentUser, requirePerm } from "../../auth/middleware";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import { hasPermIn, scopeOf } from "../../auth/scope";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { recordVectors } from "../../db/schema";
import { ApiError } from "../../lib/apiError";
import { clientFor, getAiSettings } from "../ai/service";
import type { FetchLike } from "../discovery/connectors/wazuh";
import { EXCEPTION_ACCESS } from "../exceptions/routes";
import { tFor } from "../i18n/service";
import { getRecordIndexSettings, recordIndexItems, recordIndexStatus, searchRecords, similarRecords, startRecordReindex, storeRecordIndexSettings, type RecordAccess } from "./records";

/* Hledání v záznamech podle významu (ADR-044). */

export const RECORD_ACCESS: Record<Exclude<RecordKind, "exception">, { perm: Permission; module: string }> = {
  risk: { perm: "risks:read", module: "risks" },
  vulnerability: { perm: "assets:read", module: "vulnerabilities" },
  incident: { perm: "incidents:read", module: "incidents" },
  audit_finding: { perm: "audits:read", module: "audits" },
  ai_system: { perm: "aiact:read", module: "aiact" },
  cra_finding: { perm: "cra:read", module: "cra" },
  control: { perm: "controls:read", module: "controls" },
  asset: { perm: "assets:read", module: "assets" },
  process: { perm: "processes:read", module: "processes" },
  supplier: { perm: "suppliers:read", module: "suppliers" },
  legal_review: { perm: "legislation:read", module: "legislation" },
  qa_answer: { perm: "trust:read", module: "trust" },
  knowledge: { perm: "knowledge:read", module: "knowledge" },
};
const READ_PERMS = [...new Set([...Object.values(RECORD_ACCESS).map((a) => a.perm), ...Object.values(EXCEPTION_ACCESS).map((a) => a.perm)])];

/** Rozsah: druh záznamu → společnosti, kde má uživatel čtecí oprávnění dané evidence (a modul je zapnutý). */
export async function recordAccessFor(db: Db, c: Context<AppEnv>): Promise<RecordAccess> {
  const mods = new Set((await getSettings(db)).enabledModules as string[]);
  const ids = scopeOf(c).ids;
  const pick = (perm: Permission, module: string) => (mods.has(module) ? ids.filter((id) => hasPermIn(c, perm, id)) : []);
  return {
    kinds: Object.fromEntries(Object.entries(RECORD_ACCESS).map(([k, a]) => [k, pick(a.perm, a.module)])),
    exceptionSub: Object.fromEntries(EXCEPTION_KINDS.map((k) => [k, pick(EXCEPTION_ACCESS[k].perm, EXCEPTION_ACCESS[k].module)])),
  };
}

const SYSTEM = (t: Translate) =>
  [
    "Jsi asistent GRC aplikace CONTIX. Odpovídáš na otázku uživatele VÝHRADNĚ z poskytnutých záznamů organizace (rizika, zranitelnosti, incidenty, výjimky, zjištění auditů, AI systémy, zranitelnosti produktů, opatření, aktiva, procesy, dodavatelé, posouzení změn předpisů, schválené odpovědi dotazníků a znalostní články).",
    "Pravidla:",
    "- Nic si nedomýšlej; obecné znalosti použij jen k vysvětlení pojmů, ne jako fakta o organizaci.",
    "- Každé tvrzení o organizaci doplň odkazem na záznam ve tvaru [1], [2] podle čísla záznamu.",
    "- Když záznamy odpověď neobsahují, napiš to jednou větou.",
    "- Odpovídej stručně a věcně (několik vět nebo krátký seznam).",
    t.locale === "cs" ? "- Odpovídej česky." : `- Answer in the user's language (${t.locale}).`,
  ].join("\n");

/** Odpověď AI nad záznamy (RAG) – modelu jdou jen záznamy, které uživatel smí vidět, bez jmen osob. */
export async function askRecords(db: Db, config: Config, question: string, access: RecordAccess, t: Translate, fetchImpl?: FetchLike): Promise<RecordAskAnswer> {
  const t0 = Date.now();
  const s = await getAiSettings(db);
  if (!s.enabled || !s.recordSearchEnabled) throw new ApiError(409, "err.rec.disabled");
  const { hits, mode } = await searchRecords(db, config, question, access, { limit: 8 }, fetchImpl);
  const sources = hits.map(({ text: _t, ...h }, i) => ({ ...h, n: i + 1 }));
  if (!hits.length) return { answer: t("rec.noneFound"), sources: [], mode, model: null, durationMs: Date.now() - t0 };
  const context = hits.map((h, i) => `[${i + 1}] ${RECORD_LABELS[h.kind]} – ${h.title}\n${h.text}`).join("\n\n");
  const r = await clientFor(s, config, fetchImpl).chat([
    { role: "system", content: s.instructions ? `${SYSTEM(t)}\n${s.instructions}` : SYSTEM(t) },
    { role: "user", content: `Záznamy:\n\n${context}\n\nOtázka: ${question}` },
  ]);
  const answer = r.text.replace(/<think>[\s\S]*?<\/think>/g, "").trim() || t("rec.noneFound");
  const cited = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  return { answer, sources: cited.size ? sources.filter((x) => cited.has(x.n)) : sources, mode, model: r.model, durationMs: Date.now() - t0 };
}

export function recordSearchRoutes(deps: { db: Db; config: Config; fetchImpl?: FetchLike }) {
  const { db, config } = deps;
  return new Hono<AppEnv>()
    .get("/status", requirePerm(...READ_PERMS), async (c) => c.json(await recordIndexStatus(db, scopeOf(c).ids)))
    .post("/reindex", requirePerm("admin:settings"), async (c) => {
      // na pozadí; souběh hlídá lease (v1.07)
      const started = await startRecordReindex(db, config, deps.fetchImpl);
      await audit(db, { c, user: currentUser(c), action: "records.reindex", details: { started } });
      return c.json(await recordIndexStatus(db, scopeOf(c).ids), 202);
    })
    /* ---------- správa indexu (v1.07, ADR-103) ---------- */
    .get("/index/settings", requirePerm("admin:settings"), async (c) => c.json(await getRecordIndexSettings(db)))
    .put("/index/settings", requirePerm("admin:settings"), zValidator("json", RecordIndexSettingsInput), async (c) => {
      const v = c.req.valid("json");
      await storeRecordIndexSettings(db, { disabledKinds: [...new Set(v.disabledKinds)] });
      await audit(db, { c, user: currentUser(c), action: "records.index_settings", details: v });
      await startRecordReindex(db, config, deps.fetchImpl);
      return c.json(await recordIndexStatus(db, scopeOf(c).ids));
    })
    .get(
      "/index/items",
      requirePerm("admin:settings"),
      zValidator("query", z.object({ kind: z.enum(RECORD_KINDS).optional(), q: z.string().trim().max(200).optional(), excluded: z.enum(["1"]).optional(), offset: z.coerce.number().int().min(0).max(1_000_000).default(0) })),
      async (c) => {
        const q = c.req.valid("query");
        return c.json(await recordIndexItems(db, scopeOf(c).ids, { kind: q.kind, q: q.q, excluded: q.excluded === "1", offset: q.offset }));
      },
    )
    .post("/index/exclude", requirePerm("admin:settings"), zValidator("json", z.object({ kind: z.enum(RECORD_KINDS), refId: z.string().min(1).max(200), excluded: z.boolean() })), async (c) => {
      const v = c.req.valid("json");
      const [row] = await db.select({ id: recordVectors.id, companyId: recordVectors.companyId, title: recordVectors.title }).from(recordVectors).where(and(eq(recordVectors.kind, v.kind), eq(recordVectors.refId, v.refId)));
      if (!row || !scopeOf(c).ids.includes(row.companyId)) throw new ApiError(404, "err.rec.notFound");
      await db.update(recordVectors).set({ excluded: v.excluded }).where(eq(recordVectors.id, row.id));
      await audit(db, { c, user: currentUser(c), action: v.excluded ? "records.excluded" : "records.included", details: { kind: v.kind, refId: v.refId, title: row.title } });
      return c.json({ ok: true });
    })
    .get("/search", requirePerm(...READ_PERMS), zValidator("query", z.object({ q: z.string().trim().min(2).max(500), kinds: z.string().max(100).optional() })), async (c) => {
      const q = c.req.valid("query");
      const kinds = q.kinds?.split(",").filter((k): k is RecordKind => (RECORD_KINDS as readonly string[]).includes(k));
      const r = await searchRecords(db, config, q.q, await recordAccessFor(db, c), { kinds, limit: 20 }, deps.fetchImpl);
      return c.json({ mode: r.mode, hits: r.hits.map(({ text: _t, ...h }) => h) });
    })
    .get("/similar", requirePerm(...READ_PERMS), zValidator("query", z.object({ kind: z.enum(RECORD_KINDS), id: z.string().min(1).max(200) })), async (c) => {
      const { kind, id } = c.req.valid("query");
      const access = await recordAccessFor(db, c);
      // výchozí záznam musí uživatel smět vidět
      const [self] = await db.select({ companyId: recordVectors.companyId, meta: recordVectors.meta }).from(recordVectors).where(and(eq(recordVectors.kind, kind), eq(recordVectors.refId, id)));
      if (!self) return c.json({ indexed: false, hits: [] });
      const ok = kind === "exception" ? (access.exceptionSub[String(self.meta.sub)] ?? []).includes(self.companyId) : (access.kinds[kind] ?? []).includes(self.companyId);
      if (!ok) throw new ApiError(404, "err.rec.notFound");
      return c.json(await similarRecords(db, kind, id, access));
    })
    /** Záznamy související s libovolným textem (varování regulátora, CVE, popis) – jen ty, které uživatel smí číst (v0.99). */
    .post(
      "/related",
      requirePerm(...READ_PERMS),
      zValidator("json", z.object({ text: z.string().trim().min(3).max(4000), kinds: z.array(z.enum(RECORD_KINDS)).max(10).optional(), exclude: z.object({ kind: z.enum(RECORD_KINDS), id: z.string().max(200) }).optional(), limit: z.number().int().min(1).max(20).default(8) })),
      async (c) => {
        const { text, kinds, exclude, limit } = c.req.valid("json");
        const r = await searchRecords(db, config, text, await recordAccessFor(db, c), { kinds, limit: limit + 1 }, deps.fetchImpl);
        const min = r.mode === "semantic" ? 0.45 : 0.2;
        return c.json({ mode: r.mode, hits: r.hits.filter((h) => h.score >= min && !(exclude && h.kind === exclude.kind && h.refId === exclude.id)).slice(0, limit).map(({ text: _t, ...h }) => h) });
      },
    )
    .post("/ask", requirePerm("ai:use"), zValidator("json", z.object({ question: z.string().trim().min(3).max(1000) })), async (c) => {
      const { question } = c.req.valid("json");
      const r = await askRecords(db, config, question, await recordAccessFor(db, c), await tFor(db, c), deps.fetchImpl);
      await audit(db, { c, user: currentUser(c), action: "records.asked", details: { question: question.slice(0, 300), sources: r.sources.map((x) => `${x.kind}:${x.refId}`), mode: r.mode, ms: r.durationMs } });
      return c.json(r);
    });
}
