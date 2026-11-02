import {
  osFamilyOf,
  parseVulnAdvice,
  upgradeCommand,
  verifyCommand,
  vulnPriority,
  type OsFamily,
  type Translate,
  type VulnAdviceDto,
  type VulnCveDetail,
  type VulnFixGroup,
  type VulnOccurrence,
  type VulnPriority,
} from "@contix/shared";
import { and, desc, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { inScope, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { assets, assetVulnerabilities, vulnAdvice, vulnIntel } from "../../db/schema";
import { clientFor, getAiSettings } from "../ai/service";
import type { FetchLike } from "../discovery/connectors/wazuh";
import { tFor } from "../i18n/service";
import { getVulnSla, vulnDueSql } from "./intel";

/* ============================================================
 * Detail zranitelnosti (CVE) a postup odstranění (ADR-076).
 * Pevná část: výskyty v rozsahu uživatele, příkazy správce balíčků podle rodiny OS (`upgradeCommand`).
 * AI rozbor: na pokyn uživatele (ai:use), uloží se k CVE + společnosti + jazyku a vidí ho tým; jen návrh.
 * Do modelu jdou CVE, CVSS, popis, KEV/EPSS, balíčky, verze a rodiny OS s počty – nikdy názvy aktiv ani osob.
 * ============================================================ */

type Deps = { db: Db; config: Config; fetchImpl?: FetchLike };
const CVE_ID = /^CVE-\d{4}-\d{4,7}$/;
const PRIO_ORDER: VulnPriority[] = ["p1", "p2", "p3", "p4"];

async function loadDetail(db: Db, c: Context<AppEnv>, cveId: string): Promise<Omit<VulnCveDetail, "advice" | "aiAvailable"> | null> {
  const sla = await getVulnSla(db);
  const rows = await db
    .select({
      v: assetVulnerabilities,
      assetName: assets.name,
      companyId: assets.companyId,
      osName: assets.osName,
      osVersion: assets.osVersion,
      criticality: assets.criticality,
      internetFacing: assets.internetFacing,
      due: vulnDueSql(sla),
    })
    .from(assetVulnerabilities)
    .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
    .leftJoin(vulnIntel, eq(vulnIntel.cveId, assetVulnerabilities.cveId))
    .where(and(eq(assetVulnerabilities.cveId, cveId), inScope(c, assets.companyId)))
    .orderBy(desc(assetVulnerabilities.lastSeenAt))
    .limit(2000);
  const [intel] = await db.select().from(vulnIntel).where(eq(vulnIntel.cveId, cveId));
  if (!rows.length && !intel) return null;
  const today = new Date().toISOString().slice(0, 10);
  const occurrences: VulnOccurrence[] = rows.map((r) => {
    const p = vulnPriority({ severity: r.v.severity, kev: !!intel?.kev, kevRansomware: !!intel?.kevRansomware, epss: intel?.epss ?? null, assetCriticality: r.criticality, exposed: r.internetFacing || r.v.exposed });
    const due = r.v.status === "open" ? r.due : null;
    return {
      id: r.v.id,
      assetId: r.v.assetId,
      assetName: r.assetName,
      companyId: r.companyId,
      osName: [r.osName, r.osVersion].filter(Boolean).join(" ") || null,
      osFamily: osFamilyOf(r.osName),
      packageName: r.v.packageName,
      packageVersion: r.v.packageVersion,
      status: r.v.status as VulnOccurrence["status"],
      priority: p.priority,
      due,
      overdue: !!due && due < today,
      firstSeenAt: r.v.firstSeenAt.toISOString(),
      lastSeenAt: r.v.lastSeenAt.toISOString(),
    };
  });
  const open = occurrences.filter((o) => o.status === "open");
  const base = open.length ? open : occurrences;
  const priority = base.length ? PRIO_ORDER.find((p) => base.some((o) => o.priority === p))! : vulnPriority({ severity: "unknown", kev: !!intel?.kev, epss: intel?.epss ?? null }).priority;
  // pevný postup: rodina OS × balíček (jen otevřené výskyty)
  const groups = new Map<string, VulnFixGroup & { _v: Set<string> }>();
  for (const o of open) {
    const k = `${o.osFamily}|${o.packageName}`;
    const g = groups.get(k) ?? { osFamily: o.osFamily, packageName: o.packageName, versions: [], assets: 0, command: upgradeCommand(o.osFamily, o.packageName), verify: verifyCommand(o.osFamily, o.packageName), _v: new Set<string>() };
    g.assets++;
    if (o.packageVersion) g._v.add(o.packageVersion);
    groups.set(k, g);
  }
  const fix = [...groups.values()].map(({ _v, ...g }) => ({ ...g, versions: [..._v].slice(0, 10) })).sort((a, b) => b.assets - a.assets);
  const first = rows[0]?.v;
  return {
    cveId,
    severity: first?.severity ?? "unknown",
    cvss: rows.reduce<number | null>((m, r) => (r.v.cvssScore != null && (m == null || r.v.cvssScore > m) ? r.v.cvssScore : m), null),
    description: rows.find((r) => r.v.description)?.v.description ?? null,
    reference: rows.find((r) => r.v.reference)?.v.reference ?? null,
    publishedAt: first?.publishedAt?.toISOString() ?? null,
    kev: !!intel?.kev,
    kevName: intel?.kevName ?? null,
    kevDateAdded: intel?.kevDateAdded ?? null,
    kevDueDate: intel?.kevDueDate ?? null,
    kevRansomware: !!intel?.kevRansomware,
    epss: intel?.epss ?? null,
    epssPercentile: intel?.epssPercentile ?? null,
    priority,
    open: open.length,
    occurrences,
    fix,
  };
}

/** Kontext pro model – bez názvů aktiv, hostitelů a osob. */
export function adviceContext(d: Omit<VulnCveDetail, "advice" | "aiAvailable">): string {
  const open = d.occurrences.filter((o) => o.status === "open");
  const byOs = new Map<string, number>();
  for (const o of open) byOs.set(o.osName ?? "neznámý OS", (byOs.get(o.osName ?? "neznámý OS") ?? 0) + 1);
  const lines = [
    `CVE: ${d.cveId}`,
    `Závažnost: ${d.severity}${d.cvss != null ? `, CVSS ${d.cvss}` : ""}`,
    d.publishedAt ? `Zveřejněno: ${d.publishedAt.slice(0, 10)}` : "",
    d.kev ? `CISA KEV: aktivně zneužívaná${d.kevRansomware ? " (i ransomwarem)" : ""}${d.kevName ? ` – ${d.kevName}` : ""}${d.kevDueDate ? `, termín CISA ${d.kevDueDate}` : ""}` : "CISA KEV: není v katalogu",
    d.epss != null ? `EPSS: ${Math.round(d.epss * 1000) / 10} % (pravděpodobnost zneužití do 30 dní)` : "",
    `Priorita v organizaci: ${d.priority.toUpperCase()}`,
    d.description ? `Popis ze skeneru: ${d.description.slice(0, 2500)}` : "",
    d.reference ? `Odkazy ze skeneru: ${d.reference.slice(0, 500)}` : "",
    `Otevřené výskyty: ${open.length} na ${new Set(open.map((o) => o.assetId)).size} aktivech`,
    d.fix.length ? `Dotčené balíčky (rodina OS, balíček, nainstalované verze, počet aktiv): ${d.fix.map((g) => `${g.osFamily}: ${g.packageName || "—"} ${g.versions.join(", ")} (${g.assets}×)`).join("; ")}` : "",
    byOs.size ? `Operační systémy: ${[...byOs.entries()].map(([os, n]) => `${os} (${n}×)`).join("; ")}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

const SYSTEM = [
  "Jsi expert na správu zranitelností a bezpečnost systémů. Pomáháš správcům IT zranitelnost pochopit a odstranit.",
  "Piš z pohledu obrany. Nepiš návod na zneužití ani exploit.",
  "Údaje z CONTIXu jsou fakta o organizaci. U opravených verzí, čísel bulletinů a KB, kterými si nejsi jistý, to výslovně uveď v poli caveats a doporuč ověření u výrobce / NVD – nic si nevymýšlej.",
  "Postup piš konkrétně pro uvedené operační systémy a balíčky (správce balíčků, restart služby / systému, ověření verze). U Windows uveď příslušnou aktualizaci nebo produkt, pokud ji znáš.",
  "Odpověz POUZE jedním objektem JSON bez dalšího textu v tomto tvaru:",
  '{"summary": "co je zranitelnost (2–4 věty)", "impact": "dopad při zneužití", "exploitation": "jak se zneužívá – vzdáleně/lokálně, nutnost autentizace, známé zneužití", "remediation": ["krok 1", "krok 2"], "workaround": ["dočasné opatření"], "verification": ["jak ověřit opravu"], "references": ["https://…"], "caveats": "co ověřit"}',
].join("\n");

export function vulnAdviceRoutes(deps: Deps) {
  const { db, config } = deps;
  const cveParam = (c: Context<AppEnv>) => {
    const v = (c.req.param("cveId") ?? "").toUpperCase();
    if (!CVE_ID.test(v)) throw new HTTPException(400, { message: "Neplatné označení CVE." });
    return v;
  };
  const adviceFor = async (companyId: string, cveId: string, locale: string): Promise<VulnAdviceDto | null> => {
    const [r] = await db
      .select()
      .from(vulnAdvice)
      .where(and(eq(vulnAdvice.companyId, companyId), eq(vulnAdvice.cveId, cveId), eq(vulnAdvice.locale, locale)));
    return r ? ({ ...(r.content as object), model: r.model, generatedAt: r.createdAt.toISOString(), locale: r.locale, durationMs: r.durationMs } as VulnAdviceDto) : null;
  };
  return new Hono<AppEnv>()
    .use("/cve/*", requireModule(db, "vulnerabilities"))
    .get("/cve/:cveId", requirePerm("assets:read"), async (c) => {
      const cveId = cveParam(c);
      const d = await loadDetail(db, c, cveId);
      if (!d) throw new HTTPException(404, { message: "Zranitelnost nenalezena" });
      const t = await tFor(db, c);
      const ai = await getAiSettings(db);
      const out: VulnCveDetail = { ...d, advice: await adviceFor(targetCompany(c), cveId, t.locale), aiAvailable: ai.enabled };
      return c.json(out);
    })
    .post("/cve/:cveId/advice", requirePerm("assets:read"), requirePerm("ai:use"), async (c) => {
      const cveId = cveParam(c);
      const d = await loadDetail(db, c, cveId);
      if (!d) throw new HTTPException(404, { message: "Zranitelnost nenalezena" });
      const s = await getAiSettings(db);
      if (!s.enabled) throw new HTTPException(400, { message: "AI asistent není zapnutý." });
      const t: Translate = await tFor(db, c);
      const t0 = Date.now();
      let text: string;
      let model: string;
      try {
        const r = await clientFor(s, config, deps.fetchImpl).chat([
          { role: "system", content: [SYSTEM, t.locale === "cs" ? "Texty v JSON piš česky." : `Write the JSON texts in the user's language (${t.locale}).`, s.instructions ? `Pokyny organizace: ${s.instructions}` : ""].filter(Boolean).join("\n") },
          { role: "user", content: `Zranitelnost v evidenci organizace:\n${adviceContext(d)}` },
        ]);
        text = r.text;
        model = r.model ?? s.model;
      } catch (e) {
        throw new HTTPException(502, { message: `AI: ${(e as Error).message}`.slice(0, 300) });
      }
      const advice = parseVulnAdvice(text);
      const durationMs = Date.now() - t0;
      const companyId = targetCompany(c);
      await db
        .insert(vulnAdvice)
        .values({ companyId, cveId, locale: t.locale, content: advice as unknown as Record<string, unknown>, model: model.slice(0, 200), durationMs, createdById: currentUser(c).id })
        .onConflictDoUpdate({ target: [vulnAdvice.companyId, vulnAdvice.cveId, vulnAdvice.locale], set: { content: advice as unknown as Record<string, unknown>, model: model.slice(0, 200), durationMs, createdById: currentUser(c).id, createdAt: new Date() } });
      await audit(db, { c, user: currentUser(c), action: "vuln.advice_generated", details: { cveId, model, durationMs, steps: advice.remediation.length } });
      const dto: VulnAdviceDto = { ...advice, model, generatedAt: new Date().toISOString(), locale: t.locale, durationMs };
      return c.json(dto);
    });
}

export type { OsFamily };
