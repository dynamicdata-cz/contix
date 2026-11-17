import { secTestDef, type SecTestFindingDto, type SecTestReportQuery, type SecTestRunSummary } from "@contix/shared";
import { and, desc, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { Db } from "../../db/client";
import { secTestBatches, secTestFindings, secTestRuns, secTestScopes, users } from "../../db/schema";
import { html } from "../documents/render";
import { findingDtos, runDtos } from "./service";

/* ============================================================
 * Zpráva z bezpečnostních testů (v1.63, ADR-157): rozsah a podklad, shrnutí, přehled a detail nálezů,
 * stav nápravy (úkoly, odpovědné osoby) a ověření oprav. Jen podmnožina HTML pro Word (htmlToDocx); vzhled společnosti
 * přidá printPage / htmlToDocx. Do zprávy jdou údaje, které uživatel smí číst (filtr společností z volajícího).
 * ============================================================ */

const { esc } = html;
const SEV_ORDER = ["critical", "high", "medium", "low", "info"] as const;
const SEV_TEXT: Record<string, string> = { critical: "Kritická", high: "Vysoká", medium: "Střední", low: "Nízká", info: "Informativní" };
const SEV_BG: Record<string, string> = { critical: "#fde8e8", high: "#fdf0e6", medium: "#fdf7e3", low: "#f1f5f9", info: "#ffffff" };
const SEV_FG: Record<string, string> = { critical: "#9b1c1c", high: "#a4410e", medium: "#8a6100", low: "#475569", info: "#64748b" };
const STATUS_TEXT: Record<string, string> = { open: "otevřený", fixed: "opraven (ověřeno testem)", accepted: "přijaté riziko", false_positive: "falešně pozitivní" };
const TASK_TEXT: Record<string, string> = { open: "otevřený", in_progress: "rozpracovaný / ověřuje se", done: "splněný", cancelled: "zrušený" };
const d = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [y, m, dd] = iso.slice(0, 10).split("-").map(Number);
  return `${dd}. ${m}. ${y}`;
};

export interface SecTestReport {
  title: string;
  body: string;
}

export async function secTestReport(db: Db, companyIds: string[], q: SecTestReportQuery, companyName: string): Promise<SecTestReport> {
  const batchIds = (q.batchIds ?? "").split(",").map((x) => x.trim()).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  const to = q.to ?? new Date().toISOString().slice(0, 10);
  const from = q.from ?? new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const inCo = inArray(secTestFindings.companyId, companyIds.length ? companyIds : ["00000000-0000-0000-0000-000000000000"]);
  let runs = [] as Awaited<ReturnType<typeof runDtos>>;
  let where: SQL | undefined;
  let batches: { id: string; name: string; summary: unknown }[] = [];
  if (batchIds.length) {
    batches = await db.select({ id: secTestBatches.id, name: secTestBatches.name, summary: secTestBatches.summary }).from(secTestBatches).where(and(inArray(secTestBatches.id, batchIds), inArray(secTestBatches.companyId, companyIds)));
    runs = batches.length ? await runDtos(db, inArray(secTestRuns.batchId, batches.map((b) => b.id)), 5000) : [];
    where = and(inCo, inArray(secTestFindings.runId, runs.length ? runs.map((r) => r.id) : ["00000000-0000-0000-0000-000000000000"]));
  } else {
    runs = await runDtos(db, and(inArray(secTestRuns.companyId, companyIds), gte(secTestRuns.createdAt, new Date(`${from}T00:00:00Z`)), lte(secTestRuns.createdAt, new Date(`${to}T23:59:59Z`))), 5000);
    where = and(inCo, sql`${secTestFindings.lastSeenAt} >= ${`${from}T00:00:00Z`}`, sql`${secTestFindings.firstSeenAt} <= ${`${to}T23:59:59Z`}`);
  }
  const all = await findingDtos(db, where, 5000);
  const findings = q.all ? all : all.filter((f) => f.status === "open");
  const scopeIds = [...new Set(runs.map((r) => r.scopeId))];
  const scopes = scopeIds.length
    ? await db
        .select({ s: secTestScopes, approver: users.displayName })
        .from(secTestScopes)
        .leftJoin(users, sql`${users.id} = ${secTestScopes.approvedById}`)
        .where(inArray(secTestScopes.id, scopeIds))
        .orderBy(desc(secTestScopes.createdAt))
    : [];
  const tests = [...new Set(runs.map((r) => r.testId))].map((id) => secTestDef(id)?.name ?? id);
  const dates = runs.map((r) => r.finishedAt ?? r.createdAt).sort();
  const period = dates.length ? `${d(dates[0])} – ${d(dates[dates.length - 1])}` : `${d(from)} – ${d(to)}`;
  const hosts = [...new Set(all.map((f) => f.host))];
  const count = (list: SecTestFindingDto[], s: string) => list.filter((f) => f.severity === s).length;
  const open = all.filter((f) => f.status === "open");
  const fixed = all.filter((f) => f.status === "fixed");
  const sorted = [...findings].sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity) || a.host.localeCompare(b.host));
  const title = batches.length === 1 ? `Zpráva z bezpečnostních testů – ${batches[0]!.name}` : "Zpráva z bezpečnostních testů";
  const sum = batches.map((b) => b.summary as SecTestRunSummary | null).find((x) => x?.management) ?? null;

  const parts: string[] = [];
  parts.push(`<h1>${esc(title)}</h1>`);
  parts.push(`<p class="muted">${esc(companyName)} · období testů ${esc(period)} · vytvořeno ${esc(d(new Date().toISOString()))}</p>`);

  // 1. shrnutí
  parts.push(`<h2>1. Shrnutí</h2>`);
  parts.push(
    `<table><tr>${SEV_ORDER.slice(0, 4)
      .map((s) => `<td style="background:${count(open, s) ? SEV_BG[s] : "#ffffff"};border:none;padding:8px 12px;width:25%"><b style="color:${count(open, s) ? SEV_FG[s] : "#94a3b8"};font-size:18pt">${count(open, s)}</b>&nbsp; <span style="color:#475569">${esc(SEV_TEXT[s]!)}</span></td>`)
      .join("")}</tr></table>`,
  );
  parts.push(
    `<p>Testováno ${hosts.length} ${hosts.length === 1 ? "cíl" : hosts.length < 5 ? "cíle" : "cílů"}, ${tests.length} ${tests.length === 1 ? "druh testu" : "druhů testů"}, ${runs.length} ${runs.length === 1 ? "běh" : "běhů"}. Otevřených nálezů: <b>${open.length}</b>, z toho kritických a vysokých <b>${count(open, "critical") + count(open, "high")}</b>; opravených a ověřených opakovaným testem: <b>${fixed.length}</b>.</p>`,
  );
  if (sum?.management) parts.push(`<h3>Shrnutí pro vedení</h3><p>${html.nl(sum.management)}</p>`);
  if (sum?.technical) parts.push(`<h3>Shrnutí pro techniky</h3><p>${html.nl(sum.technical)}</p>`);

  // 2. rozsah
  parts.push(`<h2>2. Rozsah a podklad testů</h2>`);
  if (scopes.length)
    parts.push(
      `<table><tr><th>Rozsah</th><th>Cíle</th><th>Platnost</th><th>Podklad (oprávnění testovat)</th><th>Schválil</th></tr>${scopes
        .map(({ s, approver }) => `<tr><td>${esc(s.name)}</td><td class="small">${esc(s.targets.join(", "))}${s.exclusions.length ? `<br>kromě ${esc(s.exclusions.join(", "))}` : ""}</td><td>${esc(d(s.validFrom))} – ${esc(d(s.validTo))}</td><td class="small">${esc(s.authorization)}</td><td>${esc(approver ?? "—")}${s.approvedAt ? `<br><span class="small">${esc(d(s.approvedAt.toISOString()))}</span>` : ""}</td></tr>`)
        .join("")}</table>`,
    );
  if (tests.length) parts.push(`<p><b>Provedené testy:</b> ${esc(tests.join(", "))}.</p>`);
  parts.push(`<p class="small">Testy proběhly jen v rámci schváleného rozsahu, sondou CONTIX s katalogem neinvazivních kontrol nebo importem výstupů nástrojů. Výsledek odráží stav v době testu.</p>`);

  // 3. přehled
  parts.push(`<h2>3. Přehled nálezů</h2>`);
  if (!sorted.length) parts.push(`<p>Žádné ${q.all ? "" : "otevřené "}nálezy.</p>`);
  else
    parts.push(
      `<table><tr><th>#</th><th>Závažnost</th><th>Nález</th><th>Cíl</th><th>Aktivum / odpovědný</th><th>Stav a náprava</th></tr>${sorted
        .map((f, i) => {
          const who = f.owners?.technical ?? f.owners?.business ?? f.task?.assigneeName ?? null;
          const task = f.task ? `úkol ${esc(f.task.code)} ${esc(TASK_TEXT[f.task.status] ?? f.task.status)}${f.task.dueDate ? `, termín ${esc(d(f.task.dueDate))}` : ""}` : "bez úkolu";
          return `<tr style="background:${SEV_BG[f.severity]}"><td>${i + 1}</td><td><b style="color:${SEV_FG[f.severity]}">${esc(SEV_TEXT[f.severity]!)}</b></td><td>${esc(f.title)}</td><td class="small">${esc(f.host)}${f.port ? `:${f.port}` : ""}</td><td class="small">${esc(f.assetName ?? "—")}${who ? `<br>${esc(who)}` : ""}</td><td class="small">${esc(STATUS_TEXT[f.status] ?? f.status)}<br>${task}</td></tr>`;
        })
        .join("")}</table>`,
    );

  // 4. detail
  if (sorted.length) {
    parts.push(`<h2>4. Popis nálezů a doporučení</h2>`);
    sorted.forEach((f, i) => {
      const a = f.advice;
      parts.push(`<h3>${i + 1}. ${esc(f.title)}</h3>`);
      parts.push(
        `<p class="small"><b style="color:${SEV_FG[f.severity]}">${esc(SEV_TEXT[f.severity]!)}</b> · ${esc(f.host)}${f.port ? `:${f.port}` : ""} · ${esc(secTestDef(f.testId)?.name ?? f.testId)} · poprvé ${esc(d(f.firstSeenAt))}, naposledy ${esc(d(f.lastSeenAt))}${f.controlLabel ? ` · opatření ${esc(f.controlLabel)}` : ""}</p>`,
      );
      parts.push(`<p>${html.nl(a?.summary || f.detail)}</p>`);
      if (a?.impact) parts.push(`<p><b>Dopad:</b> ${html.nl(a.impact)}</p>`);
      if (a?.remediation?.length) parts.push(`<p><b>Doporučená náprava:</b></p><ol>${a.remediation.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>`);
      else if (a?.summary && f.detail) parts.push(`<p><b>Doporučená náprava:</b> ${html.nl(f.detail)}</p>`);
      if (a?.verify) parts.push(`<p><b>Ověření:</b> ${html.nl(a.verify)}</p>`);
      if (q.evidence !== "0" && f.evidence) parts.push(`<p class="small"><b>Důkaz:</b><br>${html.nl(f.evidence.slice(0, 1500))}</p>`);
      const own = [f.owners?.technical && `technický garant ${f.owners.technical}`, f.owners?.business && `business vlastník ${f.owners.business}`].filter(Boolean).join(", ");
      parts.push(
        `<p class="small"><b>Stav:</b> ${esc(STATUS_TEXT[f.status] ?? f.status)}${f.task ? ` · úkol ${esc(f.task.code)} (${esc(TASK_TEXT[f.task.status] ?? f.task.status)}${f.task.assigneeName ? `, ${esc(f.task.assigneeName)}` : ""}${f.task.dueDate ? `, termín ${esc(d(f.task.dueDate))}` : ""})` : ""}${own ? ` · ${esc(own)}` : ""}</p>`,
      );
    });
  }

  // 5. ověřené opravy
  if (fixed.length) {
    parts.push(`<h2>${sorted.length ? 5 : 4}. Ověřené opravy</h2>`);
    parts.push(
      `<table><tr><th>Nález</th><th>Cíl</th><th>Závažnost</th><th>Opraveno (ověřeno testem)</th></tr>${fixed
        .map((f) => `<tr><td>${esc(f.title)}</td><td class="small">${esc(f.host)}${f.port ? `:${f.port}` : ""}</td><td>${esc(SEV_TEXT[f.severity]!)}</td><td>${esc(d(f.fixedAt ?? f.lastSeenAt))}</td></tr>`)
        .join("")}</table>`,
    );
  }
  parts.push(`<p class="small">Texty doporučení označené jako rozbor AI připravil lokální model; ověřte je před nasazením. Zpráva neobsahuje hesla ani obsah důvěrných dat.</p>`);
  return { title, body: parts.join("\n") };
}

/**
 * Zpráva z testů do balíčku pro auditora (v1.66, ADR-159): za období balíčku, všechny nálezy včetně opravených
 * a přijatých (stav nápravy), bez výstupů nástrojů. Prázdné, když v období žádný test neproběhl a nejsou otevřené nálezy.
 */
export async function secTestPackageExtras(db: Db, companyId: string, companyName: string, from: string, to: string): Promise<{ path: string; data: Uint8Array; note: string }[]> {
  const [n] = await db
    .select({ runs: sql<number>`(select count(*)::int from sec_test_runs r where r.company_id = ${companyId} and r.created_at between ${`${from}T00:00:00Z`} and ${`${to}T23:59:59Z`})`, open: sql<number>`count(*)::int` })
    .from(secTestFindings)
    .where(and(inArray(secTestFindings.companyId, [companyId]), sql`${secTestFindings.status} = 'open'`));
  if (!n || (!n.runs && !n.open)) return [];
  const r = await secTestReport(db, [companyId], { from, to, all: "1", evidence: "0" }, companyName);
  const { printPage } = await import("../documents/render");
  const { htmlToDocx } = await import("../documents/docx");
  return [
    { path: "03_bezpecnostni_testy.html", data: new TextEncoder().encode(printPage(r.title, r.body)), note: "bezpečnostní testy" },
    { path: "03_bezpecnostni_testy.docx", data: new Uint8Array(await htmlToDocx(r.body, { title: r.title })), note: "bezpečnostní testy" },
  ];
}
