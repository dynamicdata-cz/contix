/**
 * Kontrola po nasazení / aktualizaci (spouští `infra/scripts/verify.sh` v kontejneru API):
 *   bun src/scripts/verify.ts            – přehled, návratový kód 1 při chybě
 *   bun src/scripts/verify.ts --no-ai    – bez testovacího dotazu na AI model
 *
 * Ověří verzi a migrace databáze, rozšíření pgvector, stav z Provozu (systemStatus) a síťovou
 * dostupnost služeb, na které CONTIX spoléhá: AI (Open WebUI / Ollama), Wazuh Indexer, zdroje
 * hrozeb CISA KEV a EPSS. Tajemství nikdy nevypisuje.
 */
import { CONTIX_VERSION } from "@contix/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { config } from "../config";
import { db, sqlClient } from "../db/client";
import { getAiSettings, testAi } from "../modules/ai/service";
import { listWazuh } from "../modules/connections/wazuh";
import { systemStatus } from "../modules/ops/routes";
import { testIndexer } from "../modules/vulnerabilities/sources";
import { getIntelSettings } from "../modules/vulnerabilities/intel";

type Level = "ok" | "warning" | "error" | "off";
const rows: { level: Level; name: string; detail: string }[] = [];
const add = (level: Level, name: string, detail: string) => rows.push({ level, name, detail: detail.replace(/\s+/g, " ").slice(0, 400) });
const noAi = process.argv.includes("--no-ai");

async function probe(name: string, url: string, init: RequestInit & { tls?: unknown } = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: "GET", ...init, signal: AbortSignal.timeout(20_000) } as RequestInit);
    // stačí hlavička – tělo (EPSS má megabajty) se nečte
    await res.body?.cancel().catch(() => {});
    add(res.ok ? "ok" : "warning", name, `${new URL(url).host} – HTTP ${res.status} (${Date.now() - t0} ms)`);
  } catch (e) {
    add("warning", name, `${new URL(url).host} nedostupné: ${(e as Error).message} – bez internetu lze soubory nahrát ručně (Zranitelnosti → Zdroje hrozeb)`);
  }
}

try {
  // 1) verze a migrace
  add("ok", "Verze", CONTIX_VERSION);
  const journal = JSON.parse(readFileSync(join(import.meta.dir, "../../drizzle/meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
  const [applied] = (await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`)) as unknown as { n: number }[];
  const expected = journal.entries.length;
  add(applied?.n === expected ? "ok" : "error", "Migrace databáze", `${applied?.n ?? 0} z ${expected} (poslední ${journal.entries.at(-1)?.tag})`);
  const [vec] = (await db.execute(sql`select extversion from pg_extension where extname = 'vector'`)) as unknown as { extversion: string }[];
  add(vec ? "ok" : "error", "pgvector", vec ? `verze ${vec.extversion}` : "rozšíření chybí – AI hledání nebude fungovat");
  add(config.APP_SECRET && config.APP_SECRET.length >= 32 ? "ok" : "error", "APP_SECRET", config.APP_SECRET ? "nastaven" : "chybí v .env");

  // 2) stav z Provozu
  const st = await systemStatus(db, config);
  for (const c of st.checks) add(c.level as Level, `Provoz: ${c.label}`, c.detail);

  // 2b) kontrola dat po nasazení útvarů a katalogu štítků (v1.76, ADR-169) – jen počty, opravy v Kvalitě dat
  const [d] = (await db.execute(sql`select
      count(*) filter (where owner_unit_id is not null)::int as unit,
      count(*) filter (where owner_unit_id is null and coalesce(trim(owner_name), '') <> '')::int as text_only,
      count(*) filter (where exists (select 1 from unnest(tags) t where not exists (select 1 from tags g where g.name = t)))::int as tags_off
    from assets`)) as unknown as { unit: number; text_only: number; tags_off: number }[];
  if (d)
    add(
      d.text_only || d.tags_off ? "warning" : "ok",
      "Data aktiv",
      `útvar ze struktury ${d.unit}, útvar jen textem ${d.text_only}, štítky mimo katalog ${d.tags_off}${d.text_only || d.tags_off ? " – opravte hromadně v Řízení → Kvalita dat" : ""}`,
    );

  // 3) AI na lokálním modelu
  const ai = await getAiSettings(db);
  if (!ai.enabled) add("off", "AI asistent", "vypnutý");
  else if (noAi) add("off", "AI asistent", `test vynechán (--no-ai), ${ai.model} @ ${ai.baseUrl}`);
  else {
    const r = await testAi(db, config);
    add(r.ok ? "ok" : "error", "AI asistent", `${ai.model} @ ${ai.baseUrl}: ${r.message}`);
  }

  // 4) Wazuh Indexer (zranitelnosti, alerty SOC)
  const ws = await listWazuh(db, config, { enabledOnly: true });
  if (!ws.some((w) => w.indexerUrl && w.indexerUser && w.indexerPassword)) add("off", "Wazuh Indexer", "nenastaven (Administrace → Konektory)");
  for (const w of ws) {
    if (!w.indexerUrl || !w.indexerUser || !w.indexerPassword) continue;
    const label = ws.length > 1 ? `Wazuh Indexer (${w.name})` : "Wazuh Indexer";
    for (const pattern of [w.indexPattern, ...(w.alertsEnabled ? [w.alertsIndexPattern] : [])]) {
      try {
        const r = await testIndexer({ url: w.indexerUrl, user: w.indexerUser, password: w.indexerPassword, verifyTls: w.indexerVerifyTls, indexPattern: pattern });
        add("ok", `${label} ${pattern}`, `${r.count} dokumentů`);
      } catch (e) {
        add("error", `${label} ${pattern}`, (e as Error).message);
      }
    }
  }

  // 5) veřejné zdroje hrozeb (jen dostupnost – stahuje plánovač)
  const intel = await getIntelSettings(db);
  await probe("CISA KEV", intel.kevUrl);
  await probe("EPSS", intel.epssUrl);
} catch (e) {
  add("error", "Kontrola", (e as Error).message);
} finally {
  await sqlClient.end({ timeout: 5 });
}

const icon: Record<Level, string> = { ok: "\x1b[32m✔\x1b[0m", warning: "\x1b[33m!\x1b[0m", error: "\x1b[31m✖\x1b[0m", off: "\x1b[90m–\x1b[0m" };
for (const r of rows) console.log(`${icon[r.level]} ${r.name}: ${r.detail}`);
const errors = rows.filter((r) => r.level === "error").length;
const warnings = rows.filter((r) => r.level === "warning").length;
console.log(`\nVýsledek: ${errors} chyb, ${warnings} upozornění.`);
process.exit(errors ? 1 : 0);
