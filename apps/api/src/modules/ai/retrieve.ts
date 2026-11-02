import type { Context } from "hono";
import type { AppEnv } from "../../auth/service";
import { scopeOf } from "../../auth/scope";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import type { FetchLike } from "../discovery/connectors/wazuh";
import { docMeta, retrieveDocChunks } from "../policies/qa";
import { docVisibility } from "../policies/routes";
import { searchRecords } from "../search/records";
import { recordAccessFor } from "../search/routes";
import type { RetrievedSource } from "./query";
import { getAiSettings } from "./service";

/* ============================================================
 * Jednotný AI vstup (v0.50, ADR-045): k dotazu se dohledají úryvky platné dokumentace a záznamy evidencí
 * (rizika, zranitelnosti, incidenty, výjimky) – vždy jen to, co uživatel smí číst. Model pak rozhodne,
 * zda stačí, nebo spustí i čtecí nástroje nad daty.
 * ============================================================ */

const DOCS = 4;
const RECORDS = 4;
const TEXT_FOR_MODEL = 1500;
/** Minimální skóre – v režimu podle slov jsou skóre nižší (podíl shodných slov). */
const minScore = (mode: "semantic" | "keyword") => (mode === "semantic" ? 0.35 : 0.25);

const docSnippet = (t: string) => {
  const x = t.replace(/\s+/g, " ").trim();
  return x.length > 260 ? `${x.slice(0, 260)}…` : x;
};

export async function sourceRetriever(db: Db, config: Config, c: Context<AppEnv>, question: string, fetchImpl?: FetchLike) {
  // oprávnění a rozsah se vyhodnotí hned (v kontextu požadavku), hledání pak běží na pozadí
  const visible = docVisibility(db, c);
  const companyIds = scopeOf(c).accessible;
  const access = await recordAccessFor(db, c);
  return async (): Promise<RetrievedSource[]> => {
    const s = await getAiSettings(db);
    const out: Omit<RetrievedSource, "n">[] = [];
    if (s.docQaEnabled) {
      const { picked, mode } = await retrieveDocChunks(db, config, { question, companyIds, visible, topK: DOCS }, fetchImpl);
      const hits = picked.filter((h) => h.score >= minScore(mode));
      const meta = await docMeta(db, hits.map((h) => h.policyId));
      for (const h of hits) {
        const m = meta.get(h.policyId);
        if (!m) continue;
        out.push({ kind: "doc", title: `${m.code ? `${m.code} ` : ""}${m.title}`, subtitle: h.heading, link: `/docs/${h.policyId}`, snippet: docSnippet(h.text), text: h.text.slice(0, TEXT_FOR_MODEL) });
      }
    }
    if (s.recordSearchEnabled) {
      const { hits, mode } = await searchRecords(db, config, question, access, { limit: RECORDS }, fetchImpl);
      for (const h of hits.filter((x) => x.score >= minScore(mode)))
        out.push({ kind: h.kind, title: h.title, subtitle: null, link: h.link, snippet: h.snippet, text: h.text.slice(0, TEXT_FOR_MODEL) });
    }
    return out.map((x, i) => ({ ...x, n: i + 1 }));
  };
}
