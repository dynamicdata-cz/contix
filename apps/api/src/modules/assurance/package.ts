import { ASSURANCE_LABELS, AUDIT_PACKAGE_MAX_BYTES, CONTROL_LABELS, FRAMEWORKS, docTitle, type FrameworkId } from "@contix/shared";
import { and, asc, eq, gte, inArray, lte, or } from "drizzle-orm";
import { strToU8, zipSync, type Zippable } from "fflate";
import { createHash } from "node:crypto";
import { settingsFor } from "../../auth/scope";
import type { Db } from "../../db/client";
import { controlTestSamples, controlTests, controls, evidence, evidenceControls, evidenceFiles, evidenceRequirements } from "../../db/schema";
import { loadRequirementRows } from "../controls/routes";
import { htmlToDocx } from "../documents/docx";
import { html as h, printPage, renderDocument, type RenderInfo } from "../documents/render";
import { metaOf, soaSnapshot } from "../documents/snapshots";
import { safeFilename } from "./routes";

/* ============================================================
 * Balíček pro auditora (ADR-019): ZIP s přehledem požadavků → opatření → důkazy → testy,
 * SoA (HTML + Word), protokoly testů, soubory důkazů a manifest s kontrolními součty.
 * Vše offline čitelné (relativní odkazy), bez skriptů.
 * ============================================================ */

export interface PackageResult {
  zip: Uint8Array;
  filename: string;
  stats: { requirements: number; controls: number; evidence: number; files: number; tests: number; bytes: number; skippedFiles: number };
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "x";

export async function buildAuditPackage(db: Db, o: { companyId: string; framework: FrameworkId; periodFrom: string; periodTo: string; withFiles: boolean; userName: string }): Promise<PackageResult> {
  const { esc, day } = h;
  const settings = await settingsFor(db, null, o.companyId);
  const fw = FRAMEWORKS.find((f) => f.id === o.framework)!;
  const rows = await loadRequirementRows(db, o.companyId, o.framework);
  const reqIds = rows.map((r) => r.id);
  const ctlIds = [...new Set(rows.flatMap((r) => r.controls.map((c) => c.id)))];

  // důkazy: přímo k požadavkům rámce + přes opatření
  const [directLinks, ctlLinks] = await Promise.all([
    reqIds.length ? db.select().from(evidenceRequirements).where(inArray(evidenceRequirements.requirementId, reqIds)) : [],
    ctlIds.length ? db.select().from(evidenceControls).where(inArray(evidenceControls.controlId, ctlIds)) : [],
  ]);
  const evIds = [...new Set([...directLinks.map((l) => l.evidenceId), ...ctlLinks.map((l) => l.evidenceId)])];
  const evRows = evIds.length ? await db.select().from(evidence).where(inArray(evidence.id, evIds)).orderBy(asc(evidence.title)) : [];
  const files = evIds.length
    ? await db
        .select({ id: evidenceFiles.id, evidenceId: evidenceFiles.evidenceId, filename: evidenceFiles.filename, size: evidenceFiles.size, sha256: evidenceFiles.sha256, uploadedAt: evidenceFiles.uploadedAt })
        .from(evidenceFiles)
        .where(inArray(evidenceFiles.evidenceId, evIds))
    : [];

  // testy opatření: dokončené v období + otevřené
  const tests = ctlIds.length
    ? await db
        .select({ t: controlTests, code: controls.code, name: controls.name })
        .from(controlTests)
        .innerJoin(controls, eq(controls.id, controlTests.controlId))
        .where(
          and(
            inArray(controlTests.controlId, ctlIds),
            or(and(eq(controlTests.status, "completed"), gte(controlTests.performedAt, o.periodFrom), lte(controlTests.performedAt, o.periodTo)), inArray(controlTests.status, ["planned", "in_progress"])),
          ),
        )
        .orderBy(asc(controls.code), asc(controlTests.performedAt))
    : [];
  const samples = tests.length ? await db.select().from(controlTestSamples).where(inArray(controlTestSamples.testId, tests.map((t) => t.t.id))).orderBy(asc(controlTestSamples.order)) : [];

  const out: Zippable = {};
  const manifest: { path: string; sha256: string; size: number; note: string }[] = [];
  const put = (path: string, data: Uint8Array, note = "") => {
    out[path] = [data, { level: /\.(zip|png|jpe?g|pdf|docx|xlsx|gz)$/i.test(path) ? 0 : 6 }];
    manifest.push({ path, sha256: sha(data), size: data.length, note });
  };

  // soubory důkazů
  const evPath = new Map<string, string>();
  const fileLinks = new Map<string, { path: string | null; f: (typeof files)[number] }[]>();
  let total = 0;
  let skipped = 0;
  for (const [i, e] of evRows.entries()) {
    const dir = `dukazy/${String(i + 1).padStart(3, "0")}_${slug(e.title)}`;
    evPath.set(e.id, dir);
    for (const f of files.filter((x) => x.evidenceId === e.id)) {
      let path: string | null = null;
      if (o.withFiles && total + f.size <= AUDIT_PACKAGE_MAX_BYTES) {
        const [row] = await db.select({ content: evidenceFiles.content }).from(evidenceFiles).where(eq(evidenceFiles.id, f.id));
        const data = new Uint8Array(row!.content);
        path = `${dir}/${safeFilename(f.filename).replace(/[/\\]/g, "_")}`;
        if (out[path]) path = `${dir}/${f.id.slice(0, 8)}_${safeFilename(f.filename)}`;
        put(path, data, `důkaz: ${e.title}`);
        total += f.size;
        if (sha(data) !== f.sha256) manifest[manifest.length - 1]!.note += " – POZOR: kontrolní součet neodpovídá záznamu";
      } else if (o.withFiles) skipped++;
      fileLinks.set(e.id, [...(fileLinks.get(e.id) ?? []), { path, f }]);
    }
  }

  // protokoly testů
  const testPath = new Map<string, string>();
  for (const [i, { t, code, name }] of tests.entries()) {
    const path = `testy/${String(i + 1).padStart(3, "0")}_${slug(code ?? name)}_${t.kind}.html`;
    testPath.set(t.id, path);
    const sm = samples.filter((s) => s.testId === t.id);
    const body = `<div class="muted small">${esc(settings.organizationName)}</div>
<h1>Protokol testu opatření</h1>
<div class="meta"><span class="muted">Opatření</span><span>${esc(code ?? "")} ${esc(name)}</span>
<span class="muted">Druh testu</span><span>${esc(ASSURANCE_LABELS.testKind[t.kind])}</span>
<span class="muted">Metody</span><span>${esc(t.methods.map((m) => ASSURANCE_LABELS.method[m]).join(", "))}</span>
<span class="muted">Testované období</span><span>${day(t.periodFrom)} – ${day(t.periodTo)}</span>
${t.frequency ? `<span class="muted">Frekvence opatření</span><span>${esc(ASSURANCE_LABELS.frequency[t.frequency])}${t.populationSize != null ? `, populace ${t.populationSize}` : ""}</span>` : ""}
<span class="muted">Testoval/a</span><span>${esc(t.tester ?? "—")}</span>
<span class="muted">Stav</span><span>${esc(ASSURANCE_LABELS.status[t.status])}${t.performedAt ? `, provedeno ${day(t.performedAt)}` : ""}</span>
<span class="muted">Výsledek</span><span><b>${t.result ? esc(ASSURANCE_LABELS.result[t.result]) : "—"}</b> (tolerované výjimky ${t.tolerableExceptions})</span></div>
<h2>Postup</h2><p>${h.nl(t.procedure ?? "—")}</p>
<h2>Vzorky (${sm.length})</h2>
<table><thead><tr><th>Vzorek</th><th>Výsledek</th><th>Důkaz</th><th>Poznámka</th></tr></thead><tbody>${sm
      .map((s) => {
        const ev = s.evidenceId ? evRows.find((e) => e.id === s.evidenceId) : null;
        return `<tr><td>${esc(s.ref)}</td><td>${esc(ASSURANCE_LABELS.sample[s.result])}</td><td>${ev ? `<a href="../${esc(evPath.get(ev.id) ?? "")}/">${esc(ev.title)}</a>` : "—"}</td><td>${esc(s.note ?? "")}</td></tr>`;
      })
      .join("")}</tbody></table>
<h2>Závěr</h2><p>${h.nl(t.conclusion ?? "—")}</p>`;
    put(path, strToU8(printPage(`Test ${code ?? name}`, body)), `test: ${code ?? name}`);
  }

  // SoA
  const meta = metaOf(settings, { periodFrom: o.periodFrom, periodTo: o.periodTo });
  const snap = await soaSnapshot(db, meta, o.companyId, o.framework);
  const info: RenderInfo = { kind: "soa", framework: o.framework, version: null, status: "preview", title: `${docTitle("soa", o.framework)} – ${fw.shortName}`, note: `Součást balíčku pro auditora, ${day(o.periodFrom)} – ${day(o.periodTo)}`, createdByName: o.userName, createdAt: new Date().toISOString(), approvedByName: null, approvedAt: null, approvalNote: null, acknowledgements: [] };
  const soaHtml = renderDocument(snap, info);
  put("01_prohlaseni_o_aplikovatelnosti.html", strToU8(soaHtml), "SoA (náhled aktuálního stavu)");
  put("01_prohlaseni_o_aplikovatelnosti.docx", new Uint8Array(await htmlToDocx(soaHtml, { title: info.title, headerLine: settings.organizationName, landscape: true })), "SoA ve Wordu");

  // přehled požadavků
  const evByReq = new Map<string, Set<string>>();
  const add = (r: string, e: string) => (evByReq.get(r) ?? evByReq.set(r, new Set()).get(r)!).add(e);
  for (const l of directLinks) add(l.requirementId, l.evidenceId);
  for (const r of rows) for (const c of r.controls) for (const l of ctlLinks) if (l.controlId === c.id) add(r.id, l.evidenceId);
  const applicable = rows.filter((r) => r.applicable);
  const withoutEv = applicable.filter((r) => !(evByReq.get(r.id)?.size ?? 0));
  const testsByCtl = (id: string) => tests.filter((t) => t.t.controlId === id);
  const reqRows = rows
    .map((r) => {
      const evs = [...(evByReq.get(r.id) ?? [])].map((id) => evRows.find((e) => e.id === id)!).filter(Boolean);
      const ctl = r.controls
        .map((c) => {
          const ts = testsByCtl(c.id)
            .map((t) => `<a href="${esc(testPath.get(t.t.id)!)}">${esc(t.t.kind === "design" ? "návrh" : "provoz")}${t.t.result ? `: ${esc(ASSURANCE_LABELS.result[t.t.result])}` : ` (${esc(ASSURANCE_LABELS.status[t.t.status])})`}</a>`)
            .join(", ");
          return `${esc(c.code ?? "")} ${esc(c.name)} <span class="muted small">(${esc(CONTROL_LABELS.status[c.status])})</span>${ts ? `<br><span class="small">Testy: ${ts}</span>` : ""}`;
        })
        .join("<br>");
      return `<tr><td>${esc(r.ref)}</td><td class="small">${esc(r.text.slice(0, 220))}${r.text.length > 220 ? "…" : ""}</td><td>${r.applicable ? esc(CONTROL_LABELS.compliance[r.compliance]) : `Neaplikováno${r.justification ? `<br><span class="small muted">${esc(r.justification)}</span>` : ""}`}</td><td class="small">${ctl || '<span class="muted">—</span>'}</td><td class="small">${evs.map((e) => `<a href="${esc(evPath.get(e.id)!)}/">${esc(e.title)}</a>`).join("<br>") || (r.applicable ? "<b>bez důkazu</b>" : "")}</td></tr>`;
    })
    .join("");
  const evTable = evRows
    .map((e) => {
      const fl = fileLinks.get(e.id) ?? [];
      return `<tr><td><a id="${e.id}"></a>${esc(e.title)}<br><span class="small muted">${esc(ASSURANCE_LABELS.evidenceKind[e.kind])}${e.collectedAt ? `, pořízeno ${day(e.collectedAt)}` : ""}${e.periodFrom ? `, období ${day(e.periodFrom)} – ${day(e.periodTo)}` : ""}${e.validUntil ? `, platné do ${day(e.validUntil)}` : ""}</span></td><td class="small">${
        fl.map(({ path, f }) => (path ? `<a href="${esc(path)}">${esc(f.filename)}</a>` : `${esc(f.filename)} <span class="muted">(nepřiloženo)</span>`) + ` <span class="muted">SHA-256 ${f.sha256.slice(0, 16)}…</span>`).join("<br>") || "—"
      }${e.url ? `<br><a href="${esc(e.url)}">${esc(e.url)}</a>` : ""}</td></tr>`;
    })
    .join("");
  const index = `<div class="muted small">${esc(settings.organizationName)}</div>
<h1>Balíček podkladů pro auditora – ${esc(fw.name)}</h1>
<div class="meta"><span class="muted">Období</span><span>${day(o.periodFrom)} – ${day(o.periodTo)}</span><span class="muted">Vytvořeno</span><span>${h.dt(new Date().toISOString())}, ${esc(o.userName)}</span>
<span class="muted">Obsah</span><span>požadavků ${rows.length} (aplikovatelných ${applicable.length}, bez důkazu ${withoutEv.length}), důkazů ${evRows.length}, testů ${tests.length}</span></div>
<h2>Obsah balíčku</h2><ul><li><a href="01_prohlaseni_o_aplikovatelnosti.html">Prohlášení o aplikovatelnosti</a> (<a href="01_prohlaseni_o_aplikovatelnosti.docx">Word</a>)</li><li>Protokoly testů ve složce <code>testy/</code></li><li>Soubory důkazů ve složce <code>dukazy/</code></li><li><code>manifest.csv</code> a <code>SHA256SUMS</code> – kontrolní součty všech souborů</li></ul>
<h2>Požadavky, opatření, testy a důkazy</h2>
<table><thead><tr><th>Požadavek</th><th>Text</th><th>Shoda</th><th>Opatření a testy</th><th>Důkazy</th></tr></thead><tbody>${reqRows}</tbody></table>
<h2>Seznam důkazů</h2><table><thead><tr><th>Důkaz</th><th>Soubory / odkazy</th></tr></thead><tbody>${evTable || '<tr><td colspan="2">Žádné důkazy.</td></tr>'}</tbody></table>
${skipped ? `<p><b>Upozornění:</b> ${skipped} souborů nebylo přiloženo (limit velikosti balíčku) – jsou uvedeny s kontrolními součty.</p>` : ""}
<p class="small muted">Soubory důkazů jsou v CONTIX uloženy neměnně; kontrolní součty SHA-256 umožňují ověřit, že nebyly změněny.</p>`;
  put("00_obsah.html", strToU8(printPage(`Balíček pro auditora – ${fw.shortName}`, index)), "přehled");

  // manifest + SHA256SUMS
  const csv = ["cesta;sha256;velikost;poznamka", ...manifest.map((m) => `${m.path};${m.sha256};${m.size};${m.note.replace(/;/g, ",")}`)].join("\n");
  out["manifest.csv"] = strToU8(`﻿${csv}\n`);
  out["SHA256SUMS"] = strToU8(manifest.map((m) => `${m.sha256}  ${m.path}`).join("\n") + "\n");

  const zip = zipSync(out);
  return {
    zip,
    filename: `audit-${slug(fw.shortName)}-${o.periodFrom}_${o.periodTo}.zip`,
    stats: { requirements: rows.length, controls: ctlIds.length, evidence: evRows.length, files: [...fileLinks.values()].flat().filter((x) => x.path).length, tests: tests.length, bytes: zip.length, skippedFiles: skipped },
  };
}
