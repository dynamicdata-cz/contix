import { ATTACK_TACTICS, SOC_LABELS, effectiveLevel, attackTactic, attackTechnique, socSeverity, type Translate } from "@contix/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { alertSuggestions, assets, assetVulnerabilities, vulnIntel } from "../../db/schema";
import type { ChatMessage } from "../ai/provider";
import { clientFor, getAiSettings } from "../ai/service";
import type { FetchLike } from "../discovery/connectors/wazuh";

/* ============================================================
 * AI poradci SOC (ADR-046) – jen lokální model přes createAiClient.
 * Do modelu jdou údaje o alertu, technikách ATT&CK, aktivu a jeho zranitelnostech a historie pravidla;
 * nikdy jména osob (analytici, uživatelské účty ze vzorku), poznámky analytiků ani e-maily.
 * ============================================================ */

import { resolvePlaybook } from "./playbooks";

type Alert = typeof alertSuggestions.$inferSelect;

const clean = (t: string) =>
  t
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<details type="reasoning"[\s\S]*?<\/details>/g, "")
    .trim()
    .slice(0, 8000);

const lang = (t: Translate) => (t.locale === "cs" ? "Odpovídej česky." : `Answer in the user's language (${t.locale}).`);

const SYSTEM_BASE = [
  "Jsi zkušený analytik SOC a poradce pro kybernetickou bezpečnost (MITRE ATT&CK, CVE, detekce, zvládání incidentů, NIS2 / zákon o kybernetické bezpečnosti).",
  "Vysvětluješ z pohledu obrany: jak útok poznat, ověřit, zastavit a čemu předejít. Nepiš návody na útok ani funkční exploity.",
  "Údaje z CONTIXu níže jsou fakta o organizaci; obecné znalosti používej k vysvětlení. U konkrétních CVE, verzí a dat, kterými si nejsi jistý, to řekni a doporuč ověření (NVD, výrobce).",
  "Piš stručně a prakticky, bez Markdown tabulek a nadpisů – krátké odstavce nebo odrážky.",
];

/** Popis technik a taktik pro model. */
export function attackContext(ids: string[]): string {
  return ids
    .map((id) => {
      const tech = attackTechnique(id);
      const tactics = (tech?.tactics ?? []).map((t) => attackTactic(t)?.name).filter(Boolean);
      return `${id}${tech ? ` ${tech.name}` : ""}${tactics.length ? ` (taktiky: ${tactics.join(", ")})` : ""}`;
    })
    .join("; ");
}

/** Kontext alertu pro model (bez jmen osob a poznámek analytiků). */
export async function alertContext(db: Db, a: Alert): Promise<string> {
  const [asset] = a.assetId ? await db.select({ name: assets.name, type: assets.assetType, criticality: assets.criticality }).from(assets).where(eq(assets.id, a.assetId)) : [];
  const vulns = a.assetId
    ? await db
        .select({ cve: assetVulnerabilities.cveId, severity: assetVulnerabilities.severity, cvss: assetVulnerabilities.cvssScore, pkg: assetVulnerabilities.packageName })
        .from(assetVulnerabilities)
        .where(and(eq(assetVulnerabilities.assetId, a.assetId), eq(assetVulnerabilities.status, "open")))
        .orderBy(sql`${assetVulnerabilities.cvssScore} desc nulls last`)
        .limit(8)
    : [];
  const hist = await db
    .select({ status: alertSuggestions.status, verdict: alertSuggestions.verdict, n: sql<number>`count(*)::int` })
    .from(alertSuggestions)
    .where(and(eq(alertSuggestions.groupKey, a.groupKey), sql`${alertSuggestions.id} <> ${a.id}`))
    .groupBy(alertSuggestions.status, alertSuggestions.verdict);
  const sample = (a.sample ?? {}) as Record<string, unknown>;
  const pb = await resolvePlaybook(db, a);
  const lines = [
    `Alert: ${a.title ?? a.description}`,
    a.source === "manual"
      ? `Zdroj: ruční záznam SOC`
      : a.source === "wazuh"
        ? `Zdroj: Wazuh, pravidlo ${a.ruleId}, úroveň ${a.ruleLevel}`
        : a.source === "phishing"
          ? `Zdroj: hlášení phishingu zaměstnancem (${Number(sample.reports ?? 1)}× nahlášeno)`
          : `Zdroj: ${SOC_LABELS.source[a.source] ?? a.source}, pravidlo ${a.ruleId}, úroveň ${a.ruleLevel}`,
    sample.dstip ? `Cílová IP: ${String(sample.dstip)}` : "",
    Array.isArray(a.intel) && a.intel.length ? `Shoda s veřejnými zdroji hrozeb: ${(a.intel as { source: string; value: string; threat: string | null }[]).map((m) => `${m.value} (${m.source}${m.threat ? `, ${m.threat}` : ""})`).join("; ")}` : "",
    sample.category ? `Kategorie: ${String(sample.category)}` : "",
    `Závažnost: ${SOC_LABELS.severity[socSeverity(effectiveLevel(a.ruleLevel, a.exposure))]}`,
    a.exposure ? `Vazba na zranitelnosti: ${SOC_LABELS.exposure[a.exposure.reason]}${a.exposure.cves.length ? ` (${a.exposure.cves.join(", ")})` : ""}${a.exposure.exploit ? " – závažnost zvýšena o stupeň" : ""}` : "",
    a.title && a.description !== a.title ? `Popis: ${a.description.slice(0, 1500)}` : "",
    a.groups.length ? `Skupiny pravidla: ${a.groups.join(", ")}` : "",
    a.mitreIds.length ? `MITRE ATT&CK: ${attackContext(a.mitreIds)}` : "MITRE ATT&CK: nemapováno",
    `Výskyty: ${a.count}× od ${a.firstSeen.toISOString()} do ${a.lastSeen.toISOString()}`,
    a.agentName ? `Agent / hostitel: ${a.agentName}` : "",
    sample.srcip ? `Zdrojová IP: ${String(sample.srcip)}` : "",
    sample.location ? `Umístění logu: ${String(sample.location)}` : "",
    asset ? `Aktivum: ${asset.name} (typ ${asset.type}, kritičnost ${asset.criticality ?? "neurčena"})` : "Aktivum: nepřiřazeno",
    vulns.length ? `Otevřené zranitelnosti aktiva: ${vulns.map((v) => `${v.cve} (${v.severity}${v.cvss != null ? `, CVSS ${v.cvss}` : ""}${v.pkg ? `, ${v.pkg}` : ""})`).join("; ")}` : "",
    hist.length ? `Historie stejného pravidla na stejném hostiteli: ${hist.map((h) => `${SOC_LABELS.status[h.status] ?? h.status}${h.verdict ? ` / ${SOC_LABELS.verdict[h.verdict as "benign"] ?? h.verdict}` : ""}: ${h.n}×`).join(", ")}` : "Historie stejného pravidla: žádná",
    `Navržený playbook: ${pb.name} – kroky: ${pb.steps.map((s, i) => `${i + 1}) ${s.text}`).join(" ")}`,
  ];
  return lines.filter(Boolean).join("\n");
}

/** AI rozbor alertu – uloží se k alertu (vidí ho celý tým). */
export async function adviseAlert(db: Db, config: Config, a: Alert, t: Translate, fetchImpl?: FetchLike) {
  const s = await getAiSettings(db);
  const t0 = Date.now();
  const msgs: ChatMessage[] = [
    {
      role: "system",
      content: [
        ...SYSTEM_BASE,
        "Připrav rozbor alertu pro analytika SOC v těchto částech (každá 2–5 vět nebo odrážek):",
        "1. Co se pravděpodobně děje (a proč je to / není nebezpečné).",
        "2. Technika ATT&CK – co útočník typicky dělá dál; navrhni chybějící mapování, pokud alert nemapovaný.",
        "3. Rychlé ověření (triáž) – konkrétní logy a dotazy, co zkontrolovat.",
        "4. Doporučené kroky – navaž na playbook, priorita podle kritičnosti aktiva a zranitelností.",
        "5. Známky falešného poplachu a doporučený verdikt (skutečný útok / falešný poplach / neškodné / nelze určit) s odůvodněním.",
        lang(t),
        s.instructions ? `Pokyny organizace: ${s.instructions}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
    { role: "user", content: `Údaje o alertu z CONTIXu:\n${await alertContext(db, a)}` },
  ];
  const r = await clientFor(s, config, fetchImpl).chat(msgs);
  return { text: clean(r.text) || "—", model: r.model ?? s.model, at: new Date().toISOString(), durationMs: Date.now() - t0 };
}

/** Kontext CVE z evidence zranitelností (jen aktiva ve společnostech, kde to uživatel smí číst). */
async function cveContext(db: Db, cves: string[], companyIds: string[]): Promise<string[]> {
  if (!cves.length || !companyIds.length) return [];
  const rows = await db
    .select({ cve: assetVulnerabilities.cveId, severity: assetVulnerabilities.severity, cvss: assetVulnerabilities.cvssScore, pkg: assetVulnerabilities.packageName, desc: assetVulnerabilities.description, asset: assets.name, status: assetVulnerabilities.status })
    .from(assetVulnerabilities)
    .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
    .where(and(inArray(assetVulnerabilities.cveId, cves), inArray(assets.companyId, companyIds)))
    .orderBy(desc(assetVulnerabilities.cvssScore))
    .limit(200);
  const intel = new Map((await db.select().from(vulnIntel).where(inArray(vulnIntel.cveId, cves))).map((x) => [x.cveId, x]));
  const intelText = (cve: string) => {
    const x = intel.get(cve);
    if (!x) return "";
    const parts = [x.kev ? `v katalogu CISA KEV (aktivně zneužívaná${x.kevRansomware ? ", i ransomwarem" : ""}, přidána ${x.kevDateAdded ?? "?"})` : "", x.epss != null ? `EPSS ${Math.round(x.epss * 1000) / 10} %` : ""].filter(Boolean);
    return parts.length ? ` Zdroje hrozeb: ${parts.join(", ")}.` : "";
  };
  return cves.map((cve) => {
    const r = rows.filter((x) => x.cve === cve);
    if (!r.length) return `${cve}: v evidenci zranitelností organizace se nevyskytuje.${intelText(cve)}`;
    const open = r.filter((x) => x.status === "open");
    const first = r[0]!;
    return `${cve}: závažnost ${first.severity}${first.cvss != null ? `, CVSS ${first.cvss}` : ""}; balíčky ${[...new Set(r.map((x) => x.pkg).filter(Boolean))].slice(0, 5).join(", ") || "—"}; otevřené na ${open.length} aktivech (${[...new Set(open.map((x) => x.asset))].slice(0, 6).join(", ") || "—"}), celkem záznamů ${r.length}.${intelText(cve)}${first.desc ? ` Popis: ${first.desc.slice(0, 400)}` : ""}`;
  });
}

/** Obecný poradce SOC – typy útoků, techniky, zranitelnosti; volitelně nad konkrétním alertem. */
export async function askAdvisor(
  db: Db,
  config: Config,
  input: { question: string; alert: Alert | null; vulnCompanyIds: string[]; tactics30: Record<string, number> },
  t: Translate,
  fetchImpl?: FetchLike,
) {
  const s = await getAiSettings(db);
  const t0 = Date.now();
  const q = input.question;
  const cves = [...new Set((q.match(/CVE-\d{4}-\d{4,7}/gi) ?? []).map((x) => x.toUpperCase()))].slice(0, 5);
  const techs = [...new Set((q.match(/\bT\d{4}(?:\.\d{3})?\b/gi) ?? []).map((x) => x.toUpperCase()))].slice(0, 8);
  const ctx: string[] = [];
  if (input.alert) ctx.push(`Alert, ke kterému se analytik ptá:\n${await alertContext(db, input.alert)}`);
  if (techs.length) ctx.push(`Techniky ATT&CK v otázce: ${attackContext(techs)}`);
  const cveLines = await cveContext(db, cves, input.vulnCompanyIds);
  if (cveLines.length) ctx.push(`Zranitelnosti v evidenci organizace:\n${cveLines.join("\n")}`);
  const top = Object.entries(input.tactics30)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, n]) => `${ATTACK_TACTICS.find((x) => x.id === id)?.name ?? id}: ${n}`);
  if (top.length) ctx.push(`Nejčastější taktiky alertů za 30 dní: ${top.join(", ")}`);
  const r = await clientFor(s, config, fetchImpl).chat([
    { role: "system", content: [...SYSTEM_BASE, lang(t), s.instructions ? `Pokyny organizace: ${s.instructions}` : ""].filter(Boolean).join("\n") },
    { role: "user", content: `${ctx.length ? `Kontext z CONTIXu:\n${ctx.join("\n\n")}\n\n` : ""}Otázka: ${q}` },
  ]);
  return { answer: clean(r.text) || "—", model: r.model ?? s.model, durationMs: Date.now() - t0 };
}
