/**
 * Tisková HTML podoba dokumentů ISMS (Tisk → Uložit jako PDF). Veškerý obsah se escapuje.
 */
import {
  BUILTIN_PACKS,
  CS,
  createTranslator,
  formatMessage,
  type MsgKey,
  type Translate,
  fmtCzk,
  BUILTIN_RISK_METHODOLOGY,
  maxMethodologyScore,
  type FactorValues,
  type RiskMethodologyDef,
  type RiskPolicy,
  ACTION_LABELS,
  CONTROL_LABELS,
  DECREE_LEVEL_NAMES,
  docTitle,
  DOC_LABELS,
  RISK_LABELS,
  RISK_REPORT_INPUTS,
  RISK_STATUSES,
  type DocKind,
  type RiskLevel,
  type TreatmentActionDto,
  BCM_LABELS,
  CHANGE_LABELS,
  ISMS_REVIEW_INPUTS,
  OBJECTIVE_LABELS,
  type ChangeStatus,
  AUDIT_LABELS,
  INCIDENT_LABELS,
  type AuditType,
  type IncidentCategory,
  type ObjectiveStatus,
  type TestResult,
  RISK_TRIGGER_LABELS,
  RISK_SCENARIO_LABELS,
  type RiskDataReport,
  type RiskAppetiteDto,
  RISK_APPETITE_LABELS,
  type RiskTriggerKind,
  LEGACY_REPORT_BASIS,
  INFO_ASSESSMENT_LABELS,
  refIn,
  type ReportBasis,
} from "@contix/shared";
import type { IsmsReviewSnapshot, PlanSnapshot, RiskReportSnapshot, Snapshot, SnapshotMeta, SoaSnapshot } from "./snapshots";

export interface RenderInfo {
  kind: DocKind;
  framework: string | null;
  version: number | null;
  status: "draft" | "approved" | "superseded" | "preview";
  title: string;
  note: string | null;
  createdByName: string | null;
  createdAt: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  approvalNote: string | null;
  acknowledgements: { userName: string; at: string }[];
  /** Jazyk výstupu (ADR-036) – zatím jen SoA; ostatní dokumenty česky. */
  t?: Translate;
}

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const nl = (v: unknown) => esc(v).replace(/\n/g, "<br>");
let outLocale = "cs-CZ";
const dt = (v: string | null | undefined) => (v ? new Date(v).toLocaleString(outLocale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Prague" }) : "—");
const day = (v: string | null | undefined) => {
  if (!v) return "—";
  const [y, m, d] = v.slice(0, 10).split("-").map(Number);
  if (outLocale === "cs-CZ") return `${d}. ${m}. ${y}`;
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString(outLocale, { timeZone: "UTC", dateStyle: "medium" });
};
const num = (n: number) => n.toLocaleString(outLocale);
const CS_T = createTranslator("cs", new Map(BUILTIN_PACKS.map((p) => [p.locale, p] as const)));
const LEVEL_COLOR: Record<RiskLevel | "unassessed", string> = { low: "#ee9a78", medium: "#e0614a", high: "#b8302e", critical: "#7a1a1c", unassessed: "#b4b2ab" };
const lvl = (l: RiskLevel | null) =>
  l ? `<span class="lv"><i style="background:${LEVEL_COLOR[l]}"></i>${esc(RISK_LABELS.level[l])}</span>` : `<span class="muted">nehodnoceno</span>`;

const CSS = `
*{box-sizing:border-box} body{font:10.5pt/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1e293b;margin:0;background:#f1f5f9}
.page{max-width:1100px;margin:24px auto;background:#fff;padding:40px 48px;box-shadow:0 1px 3px rgba(0,0,0,.08);position:relative}
h1{font-size:20pt;margin:0 0 4px} h2{font-size:13pt;margin:28px 0 8px;border-bottom:1px solid #e2e8f0;padding-bottom:4px} h3{font-size:11pt;margin:18px 0 6px}
.muted{color:#64748b} .small{font-size:9pt} table{width:100%;border-collapse:collapse;margin:6px 0 12px} th,td{border:1px solid #e2e8f0;padding:4px 6px;vertical-align:top;text-align:left}
th{background:#f8fafc;font-weight:600;font-size:9pt} td.n{text-align:right;font-variant-numeric:tabular-nums}
.meta{display:grid;grid-template-columns:180px 1fr;gap:2px 12px;font-size:9.5pt;margin:12px 0}
.lv{white-space:nowrap} .lv i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.wm{position:absolute;top:18px;right:48px;border:2px solid #b45309;color:#b45309;padding:2px 10px;font-weight:700;letter-spacing:.08em;transform:rotate(4deg)}
.sig{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:12px} .sig div{border-top:1px solid #94a3b8;padding-top:4px;font-size:9pt}
.pts{margin:2px 0 0 12px;padding:0;list-style:none;font-size:9pt;color:#475569} .na{color:#94a3b8;text-decoration:line-through}
.assess{border-left:3px solid #94a3b8;padding:4px 10px;margin:8px 0;background:#f8fafc}
.bar{display:flex;height:10px;border-radius:2px;overflow:hidden;background:#e2e8f0}.bar span{display:block}
.toolbar{max-width:1100px;margin:16px auto 0;text-align:right} .toolbar button{font:inherit;padding:6px 14px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;cursor:pointer}
@media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none;padding:0}.toolbar{display:none}h2{break-after:avoid}tr{break-inside:avoid}@page{size:A4;margin:14mm}}
`;

function header(meta: SnapshotMeta, info: RenderInfo, t: Translate) {
  const wm = info.status === "approved" ? "" : `<div class="wm">${esc(info.status === "preview" ? t("doc.wm.preview") : info.status === "superseded" ? t("doc.wm.superseded") : t("doc.wm.draft"))}</div>`;
  return `${wm}
<div class="muted small">${esc(meta.organizationName)}${meta.organizationIco ? `, ${esc(t("doc.ico"))} ${esc(meta.organizationIco)}` : ""}${meta.organizationAddress ? `, ${esc(meta.organizationAddress)}` : ""}</div>
<h1>${esc(info.title)}</h1>
<div class="muted">${esc(meta.basis ? (t.locale === "cs" ? meta.basis.legal[info.kind] : meta.basis.legalEn[info.kind]) : t.dyn(`doc.legal.${info.kind}`, DOC_LABELS.legal[info.kind]))}</div>
<div class="meta">
${meta.basis ? `<span class="muted">${esc(t("doc.framework"))}</span><span>${esc(t.locale === "cs" ? meta.basis.label : meta.basis.labelEn)}</span>` : ""}
<span class="muted">${esc(t("doc.version"))}</span><span>${info.version ?? esc(t("doc.unsaved"))} – ${esc(info.status === "preview" ? t("doc.previewState") : t.dyn(`doc.status.${info.status}`, DOC_LABELS.status[info.status]))}</span>
${meta.regulatedServices ? `<span class="muted">${esc(t("doc.regulatedService"))}</span><span>${nl(meta.regulatedServices)}</span>` : ""}
<span class="muted">${esc(t("doc.asOf"))}</span><span>${dt(meta.generatedAt)}</span>
${meta.periodFrom || meta.periodTo ? `<span class="muted">${esc(t("doc.period"))}</span><span>${day(meta.periodFrom)} – ${day(meta.periodTo)}</span>` : ""}
${info.createdByName ? `<span class="muted">${esc(t("doc.preparedBy"))}</span><span>${esc(info.createdByName)}, ${dt(info.createdAt)}</span>` : ""}
${info.approvedAt ? `<span class="muted">${esc(t("doc.approvedBy"))}</span><span>${esc(info.approvedByName)}, ${dt(info.approvedAt)}${info.approvalNote ? ` – ${esc(info.approvalNote)}` : ""}</span>` : ""}
${info.note ? `<span class="muted">${esc(t("doc.note"))}</span><span>${nl(info.note)}</span>` : ""}
</div>`;
}

function footer(info: RenderInfo, t: Translate) {
  const acks = info.acknowledgements.length
    ? `<table><thead><tr><th>${esc(t("doc.ackBy"))}</th><th>${esc(t("doc.ackAt"))}</th></tr></thead><tbody>${info.acknowledgements
        .map((a) => `<tr><td>${esc(a.userName)}</td><td>${dt(a.at)}</td></tr>`)
        .join("")}</tbody></table>`
    : `<p class="muted">${esc(t("doc.noAck"))}</p>`;
  return `<h2>${esc(t("doc.approval"))}</h2>
<p class="small muted">${
    info.kind === "isms_review"
      ? esc(t("doc.ackIsms"))
      : esc(t("doc.ackRisk"))
  }</p>
${acks}
<div class="sig"><div>${esc(t("doc.preparedBy"))}: ${esc(info.createdByName ?? "")}</div><div>${esc(t("doc.approvedBy"))}: ${esc(info.approvedByName ?? "")}</div></div>`;
}

function page(info: RenderInfo, body: string, t: Translate) {
  return `<!doctype html><html lang="${esc(t.locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(info.title)}${info.version ? ` v${info.version}` : ""}</title><style>${CSS}</style></head>
<body><div class="toolbar"><button onclick="window.print()">${esc(t("print.button"))}</button></div><div class="page">${body}</div></body></html>`;
}

/* ---------- SoA ---------- */

const STATUS_410: Record<string, MsgKey> = { compliant: "soa.410.done", partial: "soa.410.progress", non_compliant: "soa.410.not", not_assessed: "soa.410.not", not_applicable: "soa.410.not" };

function renderSoa(s: SoaSnapshot, info: RenderInfo, t: Translate) {
  const cl = (k: string) => t.dyn(`enum.compliance.${k}`, (CONTROL_LABELS.compliance as Record<string, string>)[k] ?? k);
  const is410 = s.framework.id === "cz410";
  const sum = s.summary;
  const bar = (["compliant", "partial", "non_compliant", "not_assessed"] as const)
    .map((k) => {
      const color = { compliant: "#0ca30c", partial: "#ec835a", non_compliant: "#d03b3b", not_assessed: "#b4b2ab" }[k];
      return sum.byCompliance[k] ? `<span style="width:${(sum.byCompliance[k] / Math.max(1, sum.applicable)) * 100}%;background:${color}" title="${esc(cl(k))}"></span>` : "";
    })
    .join("");
  let body = `<h2>${esc(t("soa.summary"))}</h2>
<p>${esc(s.framework.name)} – ${esc(t("soa.summaryText", { total: sum.total, applicable: sum.applicable }))} <b>${esc(t("soa.score", { score: num(sum.score) }))}</b>
(${esc(t("soa.breakdown", { c: sum.byCompliance.compliant, p: sum.byCompliance.partial, n: sum.byCompliance.non_compliant, u: sum.byCompliance.not_assessed, na: sum.byCompliance.not_applicable }))}).</p>
<div class="bar">${bar}</div>
<table><thead><tr><th>${esc(t("soa.col.section"))}</th><th class="n">${esc(t("soa.col.requirements"))}</th><th class="n">${esc(t("soa.col.applied"))}</th><th class="n">${esc(t("soa.col.score"))}</th></tr></thead><tbody>
${sum.sections.map((x) => `<tr><td>${esc(x.section)} ${esc(x.title)}</td><td class="n">${x.total}</td><td class="n">${x.applicable}</td><td class="n">${num(x.score)} %</td></tr>`).join("")}
</tbody></table>
<h2>${esc(is410 ? t("soa.overview410") : t("soa.overview"))}</h2>`;
  if (!s.framework.fullText) body += `<p class="small muted">${esc(t("soa.shortTexts", { source: s.framework.source }))}</p>`;
  const head = is410
    ? `<tr><th style="width:14%">${esc(t("soa.410.col.measure"))}</th><th style="width:9%">${esc(t("soa.410.col.state"))}</th><th>${esc(t("soa.410.col.description"))}</th><th style="width:9%">${esc(t("soa.410.col.due"))}</th><th style="width:7%">${esc(t("soa.410.col.priority"))}</th><th style="width:13%">${esc(t("soa.410.col.owner"))}</th></tr>`
    : `<tr><th style="width:12%">${esc(t("soa.col.provision"))}</th><th style="width:34%">${esc(t("soa.col.requirement"))}</th><th style="width:8%">${esc(t("soa.col.applied"))}</th><th style="width:9%">${esc(t("soa.col.score"))}</th><th>${esc(t("soa.col.how"))}</th></tr>`;
  let rows = "";
  let last = "";
  for (const r of s.rows) {
    if (r.section !== last) {
      rows += `<tr><th colspan="${is410 ? 6 : 5}">${esc(r.section)} ${esc(r.sectionTitle)}</th></tr>`;
      last = r.section;
    }
    const ctl = r.controls.map((c) => `${esc(c.code ?? "")} ${esc(c.name)} (${esc(c.status)})`).join("; ");
    const how = r.applicable
      ? [r.implementationNote ? nl(r.implementationNote) : "", ctl ? `<span class="muted small">${esc(t("soa.controls"))}: ${ctl}</span>` : ""].filter(Boolean).join("<br>")
      : `<b>${esc(t("soa.notApplied"))}:</b> ${nl(r.justification)}${r.compensating ? `<br><b>${esc(t("soa.compensating"))}:</b> ${nl(r.compensating)}` : ""}`;
    const req = `${r.lead ? `<span class="muted small">${esc(r.lead)} …</span><br>` : ""}<span class="${r.applicable ? "" : "na"}">${esc(r.text)}</span>${
      r.points.length ? `<ul class="pts">${r.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""
    }`;
    rows += is410
      ? `<tr><td>${esc(r.ref)}<br>${req}</td><td>${esc(t(STATUS_410[r.compliance]!))}</td><td>${how || "—"}</td><td>${r.compliance === "compliant" ? "" : day(r.dueDate)}</td><td>${r.priority ?? ""}</td><td>${esc(r.ownerPositionName ?? "")}</td></tr>`
      : `<tr><td>${esc(r.ref)}</td><td>${req}</td><td>${esc(r.applicable ? t("common.yes") : t("common.no"))}</td><td>${esc(cl(r.compliance))}</td><td>${how || "—"}</td></tr>`;
  }
  body += `<table><thead>${head}</thead><tbody>${rows}</tbody></table>`;
  return body;
}

/* ---------- zpráva o hodnocení rizik ---------- */

function actionsTable(actions: TreatmentActionDto[], showRisk = true) {
  if (!actions.length) return `<p class="muted">Žádné akce.</p>`;
  return `<table><thead><tr>${showRisk ? "<th>Riziko</th>" : ""}<th>1. Opatření</th><th>2. Cíle a přínosy</th><th>3. Odpovědnost</th><th>4. Zdroje</th><th>5. Termín</th><th>6. Vazba</th><th>7. Způsob realizace</th><th>Stav</th></tr></thead><tbody>
${actions
  .map(
    (a) => `<tr>${showRisk ? `<td>${esc(a.riskCode ?? "")} ${esc(a.riskName)}<br>${lvl(a.riskLevel)}</td>` : ""}<td>${esc(a.title)}${a.description ? `<br><span class="small muted">${nl(a.description)}</span>` : ""}</td>
<td>${nl(a.objective)}</td><td>${esc(a.ownerPositionName ?? "neurčeno")}</td>
<td class="small">${[a.resourcesHuman && `lidské: ${esc(a.resourcesHuman)}`, a.resourcesFinancial && `finanční: ${esc(a.resourcesFinancial)}`, a.resourcesTechnical && `technické: ${esc(a.resourcesTechnical)}`, a.costEstimate != null && `odhad ${a.costEstimate.toLocaleString("cs-CZ")} Kč`].filter(Boolean).join("<br>")}</td>
<td>${day(a.dueDate)}${a.overdue ? " ⚠" : ""}</td><td class="small">riziko ${esc(a.riskCode ?? a.riskName)}${a.controlName ? `<br>opatření ${esc(a.controlCode ?? "")} ${esc(a.controlName)}` : ""}</td>
<td>${nl(a.realization)}</td><td>${esc(ACTION_LABELS[a.status])}</td></tr>`,
  )
  .join("")}</tbody></table>`;
}

/** Popis importované metodiky hodnocení rizik (faktory, oblasti, vzorec, úrovně, kroky). */
function methodologySection(m: RiskMethodologyDef, p: RiskPolicy, B: ReportBasis) {
  const scale = (f: RiskMethodologyDef["factors"][number]) =>
    `<h3>${esc(f.label)}${f.perArea ? " (hodnotí se v každé oblasti dopadu)" : ""}</h3>${f.description ? `<p class="small">${nl(f.description)}</p>` : ""}<table style="width:auto"><thead><tr><th>Hodnota</th><th>Název</th><th>Popis</th></tr></thead><tbody>${f.scale
      .map((x) => `<tr><td class="n">${x.value}</td><td>${esc(x.label)}</td><td class="small">${x.description ? nl(x.description) : ""}</td></tr>`)
      .join("")}</tbody></table>`;
  const range = (r: { min?: number; max?: number }) => (r.min !== undefined && r.min === r.max ? `= ${r.min}` : r.min !== undefined && r.max !== undefined ? `${r.min}–${r.max}` : r.min !== undefined ? `≥ ${r.min}` : r.max !== undefined ? `≤ ${r.max}` : "");
  const rules = m.rules?.length
    ? `<h3>Pravidla zařazení</h3><table><thead><tr><th>Úroveň</th><th>Podmínky (všechny musí platit, první shoda)</th></tr></thead><tbody>${m.rules
        .map((r) => `<tr><td>${esc(m.levels.find((l) => l.key === r.level)?.label ?? r.level)}</td><td>${Object.entries(r.when).map(([k, v]) => `${esc(k === "score" ? "skóre" : (m.factors.find((f) => f.key === k)?.label ?? k))} ${esc(range(v))}`).join(", ")}</td></tr>`)
        .join("")}</tbody></table>`
    : "";
  return `<h2>1. Metodika</h2>
<p>Hodnocení rizik je prováděno dle ${esc(B.risk.method)} metodikou <b>${esc(m.name)}</b> (verze ${esc(m.version)}${m.source ? `, ${esc(m.source)}` : ""}).</p>
${m.description ? `<p>${nl(m.description)}</p>` : ""}
<p>Funkce pro určení rizika: <b>skóre = ${esc(m.formula)}</b>${m.areas?.length ? `; faktory hodnocené po oblastech se slučují jako ${esc({ weighted_sum: "vážený součet", sum: "součet", max: "maximum", weighted_max: "vážené maximum" }[m.areaAggregate])}` : ""}, maximální skóre ${maxMethodologyScore(m)}.</p>
${m.areas?.length ? `<h3>Oblasti dopadu</h3><table style="width:auto"><thead><tr><th>Oblast</th><th class="n">Váha (priorita)</th></tr></thead><tbody>${m.areas.map((a) => `<tr><td>${esc(a.label)}${a.description ? `<br><span class="small muted">${esc(a.description)}</span>` : ""}</td><td class="n">${a.weight}</td></tr>`).join("")}</tbody></table>` : ""}
${m.factors.map(scale).join("")}
<h3>Úrovně rizika</h3><table><thead><tr><th>Úroveň metodiky</th><th>Úroveň CONTIX</th>${m.rules?.length ? "" : '<th class="n">Skóre</th>'}<th>Zvládání</th><th>Akceptovatelné</th></tr></thead><tbody>${m.levels
    .map((l) => `<tr><td>${esc(l.label)}${l.description ? `<br><span class="small muted">${esc(l.description)}</span>` : ""}</td><td>${lvl(l.mapsTo)}</td>${m.rules?.length ? "" : `<td class="n">${esc(range(l))}</td>`}<td class="small">${esc(l.treatment ?? "")}</td><td>${l.acceptable ? "ano" : "ne"}</td></tr>`)
    .join("")}</tbody></table>
${rules}
<p><b>Kritérium akceptovatelnosti${esc(refIn(B.risk.criteria))}:</b> akceptovatelné jsou úrovně ${esc(m.levels.filter((l) => l.acceptable).map((l) => l.label).join(", ") || "žádné")}.
Hodnocení se provádí alespoň jednou za ${p.reviewMonths} měsíců a při významných změnách.</p>
${m.steps?.length ? `<h3>Postup</h3><ol>${m.steps.map((x) => `<li><b>${esc(x.title)}</b>${x.description ? ` – ${esc(x.description)}` : ""}</li>`).join("")}</ol>` : ""}`;
}

function factorSummary(m: RiskMethodologyDef | undefined, v: FactorValues | null | undefined) {
  if (!v) return "–";
  return Object.entries(v)
    .map(([k, x]) => {
      const label = m?.factors.find((f) => f.key === k)?.label ?? k;
      return typeof x === "number" ? `${label} ${x}` : `${label} ${Object.values(x).join("/")}`;
    })
    .join("; ");
}

function quantSection(q: NonNullable<RiskReportSnapshot["quant"]>) {
  const p = q.policy;
  return `<h2>5a. Kvantitativní analýza (FAIR)</h2>
<p>U vybraných rizik je odhadnuta četnost incidentů za rok a ztráta z jednoho incidentu jako rozpětí (minimum, nejpravděpodobnější, maximum);
roční ztráta je spočtena simulací Monte Carlo (${p.iterations.toLocaleString("cs-CZ")} opakování). Kvantitativní výsledek doplňuje kvalitativní hodnocení dle přílohy č. 4.</p>
<p>Pásma očekávané roční ztráty: nízké do ${esc(fmtCzk(p.maxLow))}, střední do ${esc(fmtCzk(p.maxMedium))}, vysoké do ${esc(fmtCzk(p.maxHigh))}, kritické nad.
${p.appetiteYear != null ? `Ochota nést riziko: roční ztráta s pravděpodobností 95 % do <b>${esc(fmtCzk(p.appetiteYear))}</b>.` : ""}</p>
${q.portfolio ? `<p>Celkem za kvantifikovaná rizika: očekávaná roční ztráta <b>${esc(fmtCzk(q.portfolio.mean))}</b>, s pravděpodobností 95 % nepřekročí <b>${esc(fmtCzk(q.portfolio.p95))}</b> (99 %: ${esc(fmtCzk(q.portfolio.p99))})${q.residualPortfolio ? `; po opatřeních ${esc(fmtCzk(q.residualPortfolio.mean))} / ${esc(fmtCzk(q.residualPortfolio.p95))}` : ""}.${p.appetiteYear != null ? (q.portfolio.p95 > p.appetiteYear ? " <b>Nad ochotou nést riziko.</b>" : " V mezích ochoty nést riziko.") : ""}</p>` : ""}
<table><thead><tr><th>Riziko</th><th class="n">Očekávaná roční ztráta</th><th class="n">95 %</th><th>Úroveň</th><th class="n">Po opatřeních</th><th class="n">ROSI</th></tr></thead><tbody>${q.items
    .map((i) => `<tr><td>${esc(i.code ?? "")} ${esc(i.name)}</td><td class="n">${esc(fmtCzk(i.ale))}</td><td class="n">${esc(fmtCzk(i.p95))}</td><td>${lvl(i.level)}</td><td class="n">${i.residualAle != null ? esc(fmtCzk(i.residualAle)) : "—"}</td><td class="n">${i.rosi != null ? `${Math.round(i.rosi * 100)} %` : "—"}</td></tr>`)
    .join("")}</tbody></table>`;
}

function renderRiskReport(s: RiskReportSnapshot, info: RenderInfo) {
  const p = s.policy;
  const three = p.method === "three_factor";
  const N = p.levels;
  const scaleTable = (title: string, steps: { value: number; name: string; description: string; decree: number[] }[]) =>
    `<h3>${esc(title)}</h3><table><thead><tr><th style="width:6%">Úroveň</th><th style="width:12%">Název</th><th>Popis</th>${N !== 4 ? '<th style="width:14%">Úroveň vyhlášky</th>' : ""}</tr></thead><tbody>${steps
      .map((x) => `<tr><td class="n">${x.value}</td><td>${esc(x.name)}</td><td>${esc(x.description)}</td>${N !== 4 ? `<td>${x.decree.map((d) => DECREE_LEVEL_NAMES[d]).join(" až ")}</td>` : ""}</tr>`)
      .join("")}</tbody></table>`;
  const b = s.bounds;
  const idx = Array.from({ length: N }, (_, i) => i + 1);
  const matrix = `<table style="width:auto"><thead><tr><th>Dopad \\ pravděpodobnost</th>${idx.map((l) => `<th class="n">${l}</th>`).join("")}</tr></thead><tbody>${[...idx]
    .reverse()
    .map((i) => `<tr><th>${i}</th>${idx.map((l) => `<td class="n">${s.matrix[i - 1]?.[l - 1] || ""}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
  const unacc = s.risks.filter((r) => r.acceptable === false && r.status !== "closed");
  const covT = s.coverage.filter((c) => c.kind === "threat");
  const covW = s.coverage.filter((c) => c.kind === "weakness");
  const cov = (list: typeof covT) =>
    `<table><tbody>${list.map((c) => `<tr><td style="width:8%">${esc(c.code)}</td><td>${esc(c.name)}</td><td class="n" style="width:10%">${c.risks || '<span class="muted">0</span>'}</td></tr>`).join("")}</tbody></table>`;

  const m = s.methodology;
  const B = s.meta.basis ?? LEGACY_REPORT_BASIS;
  const method = m ? methodologySection(m, p, B) : `<h2>1. Metodika</h2>
<p>Hodnocení rizik je prováděno dle ${B.id === "cz409" ? "§ 8 a přílohy č. 4 vyhlášky č. 409/2025 Sb." : `${esc(B.risk.method)} metodikou podle přílohy č. 4 vyhlášky č. 409/2025 Sb.`} Funkce pro určení rizika:
<b>${three ? "riziko = hodnota aktiva × hrozba × zranitelnost" : "riziko = dopad (hodnota aktiva) × pravděpodobnost scénáře (sloučená hrozba a zranitelnost dle odst. 5 přílohy č. 4)"}</b>,
stupnice ${N} úrovní${N === 4 ? " (dle tab. č. 1 a 2 přílohy č. 4)" : " s převodem na úrovně vyhlášky (odst. 5 přílohy č. 4)"}, skóre 1–${s.maxScore}.
Hodnota aktiva vychází z hodnocení aktiv dle přílohy č. 1 (důvěrnost, integrita, dostupnost).</p>
<table style="width:auto"><thead><tr><th>Úroveň rizika</th><th>Skóre</th><th>Význam (tab. č. 3)</th></tr></thead><tbody>
<tr><td>${lvl("low")}</td><td class="n">1–${b.maxLow}</td><td>${esc(RISK_LABELS.levelDesc.low)}</td></tr>
<tr><td>${lvl("medium")}</td><td class="n">${b.maxLow + 1}–${b.maxMedium}</td><td>${esc(RISK_LABELS.levelDesc.medium)}</td></tr>
<tr><td>${lvl("high")}</td><td class="n">${b.maxMedium + 1}–${b.maxHigh}</td><td>${esc(RISK_LABELS.levelDesc.high)}</td></tr>
<tr><td>${lvl("critical")}</td><td class="n">${b.maxHigh + 1}–${s.maxScore}</td><td>${esc(RISK_LABELS.levelDesc.critical)}</td></tr>
</tbody></table>
<p><b>Kritérium akceptovatelnosti${esc(refIn(B.risk.criteria))}:</b> akceptovatelná jsou ${p.acceptLevel === "low" ? "pouze nízká rizika" : "nízká a střední rizika"}.
Hodnocení se provádí alespoň jednou za ${p.reviewMonths} měsíců a při významných změnách.</p>
${scaleTable("Stupnice hodnoty aktiva / dopadu", s.scales.impact)}
${three ? scaleTable("Stupnice hrozeb (tab. č. 1)", s.scales.threat) + scaleTable("Stupnice zranitelností (tab. č. 2)", s.scales.vulnerability) : scaleTable("Stupnice pravděpodobnosti scénáře", s.scales.likelihood)}

`;
  return `${method}
<h2>2. Zohledněné vstupy${esc(refIn(B.risk.inputs))}</h2>
<table><tbody>${RISK_REPORT_INPUTS.map(
  (i, n) =>
    `<tr><td style="width:36%">${n + 1}. ${esc(i.label)}</td><td>${s.inputs[i.key] ? nl(s.inputs[i.key]) : '<span class="muted">neuvedeno</span>'}${
      i.key === "changes" && s.significantChanges?.length
        ? `<ul class="pts">${s.significantChanges.map((c) => `<li>${esc(c.code ?? "")} ${esc(c.title)} – ${esc(CHANGE_LABELS.status[c.status as ChangeStatus] ?? c.status)}${c.day ? `, ${day(c.day)}` : ""}</li>`).join("")}</ul><span class="small muted">z evidence významných změn${esc(refIn(B.risk.changes))}</span>`
        : ""
    }${
      i.key === "threats" && s.infoItems?.length ? infoList(s.infoItems) : ""
    }${
      i.key === "incidents" && s.incidents?.length
        ? `<ul class="pts">${s.incidents.map((x) => `<li>${esc(x.code ?? "")} ${esc(x.title)} – ${esc(INCIDENT_LABELS.category[x.category as IncidentCategory] ?? x.category)}, ${day(x.detectedAt)}${x.significant ? ", významný dopad" : ""}</li>`).join("")}</ul><span class="small muted">z evidence incidentů</span>`
        : ""
    }${
      i.key === "audits" && s.audits && (s.audits.audits.length || s.audits.openFindings)
        ? `<ul class="pts">${s.audits.audits.map((a) => `<li>${esc(a.code ?? "")} ${esc(a.title)} (${day(a.performedEnd)}): závažné neshody ${a.findings.major ?? 0}, méně závažné ${a.findings.minor ?? 0}, pozorování ${a.findings.observation ?? 0}</li>`).join("")}</ul><span class="small muted">otevřená zjištění ${s.audits.openFindings}, po termínu ${s.audits.overdueFindings} – z evidence auditů</span>`
        : ""
    }</td></tr>`,
).join("")}</tbody></table>

<h2>3. Výsledky hodnocení</h2>
<p>Hodnocených otevřených rizik: <b>${s.counts.total}</b>. Nad hranicí akceptovatelnosti: <b>${s.counts.unacceptable}</b>, z toho bez ošetření: <b>${s.counts.untreated}</b>.</p>
<table style="width:auto"><thead><tr><th>Úroveň</th><th class="n">Aktuální</th><th class="n">Zbytkové</th></tr></thead><tbody>
${(["critical", "high", "medium", "low"] as const).map((l) => `<tr><td>${lvl(l)}</td><td class="n">${s.counts.byLevel[l]}</td><td class="n">${s.counts.residualByLevel[l]}</td></tr>`).join("")}
<tr><td class="muted">nehodnoceno</td><td class="n">${s.counts.byLevel.unassessed}</td><td class="n">${s.counts.residualByLevel.unassessed}</td></tr></tbody></table>
${m ? "" : `<h3>Matice rizik (počty)</h3>${matrix}`}

<h2>4. Registr rizik</h2>
<table><thead><tr><th>Riziko</th><th>Hrozba / zranitelnost</th><th>Aktiva / procesy</th><th class="n">${m ? "Hodnocení" : three ? "A×H×Z" : "D×P"}</th><th>Úroveň</th><th>Zvládání</th><th>Zbytkové</th><th>Vlastník</th></tr></thead><tbody>
${s.risks
  .map(
    (r) => `<tr><td>${esc(r.code ?? "")} ${esc(r.name)}<br><span class="small muted">${esc(RISK_LABELS.status[r.status as (typeof RISK_STATUSES)[number]] ?? r.status)}${r.assessedAt ? `, hodnoceno ${day(r.assessedAt)}` : ""}${r.scaleLevels !== N ? `, stupnice ${r.scaleLevels}` : ""}</span></td>
<td class="small">${esc(r.threat ?? "—")}<br><span class="muted">${esc(r.weakness ?? "")}</span></td>
<td class="small">${esc(r.assets.join(", "))}${r.processes.length ? `<br><span class="muted">${esc(r.processes.join(", "))}</span>` : ""}</td>
<td class="n">${r.methodologyKey && r.methodologyKey !== BUILTIN_RISK_METHODOLOGY ? `<span class="small">${esc(factorSummary(m, r.factorValues))}</span>` : three ? `${r.impact ?? "–"}×${r.threatLevel ?? "–"}×${r.vulnLevel ?? "–"}` : `${r.impact ?? "–"}×${r.likelihood ?? "–"}`}${r.score != null ? ` = <b>${r.score}</b>` : ""}</td>
<td>${lvl(r.level)}${r.levelLabel ? `<br><span class="small">${esc(r.levelLabel)}</span>` : ""}${r.acceptable === false ? '<br><span class="small">nad hranicí</span>' : ""}</td>
<td class="small">${r.treatment ? esc(RISK_LABELS.treatment[r.treatment as keyof typeof RISK_LABELS.treatment] ?? r.treatment) : "—"}${r.treatmentDue ? `<br>do ${day(r.treatmentDue)}` : ""}</td>
<td>${r.residualScore != null ? `${lvl(r.residualLevel)} (${r.residualScore})` : "—"}</td><td class="small">${esc(r.owner ?? "")}</td></tr>`,
  )
  .join("")}</tbody></table>

<h2>5. Rizika nad hranicí akceptovatelnosti a jejich zvládání</h2>
${unacc.length ? `<ul>${unacc.map((r) => `<li>${esc(r.code ?? "")} ${esc(r.name)} – ${lvl(r.level)}${r.treatment ? `, ${esc(RISK_LABELS.treatment[r.treatment as keyof typeof RISK_LABELS.treatment] ?? r.treatment)}` : ", <b>bez ošetření</b>"}</li>`).join("")}</ul>` : "<p>Žádná.</p>"}
<h3>Plán zvládání rizik${esc(refIn(B.risk.plan))}</h3>
${actionsTable(s.actions.filter((a) => a.status !== "cancelled"))}

${s.quant ? quantSection(s.quant) : ""}
<h2>6. Zvážené kategorie hrozeb a zranitelností (příloha č. 3)</h2>
<p class="small muted">Počet otevřených rizik, ve kterých je kategorie použita. Kategorie bez rizika byla zvážena jako nerelevantní nebo je pokryta jiným scénářem.</p>
<h3>Hrozby</h3>${cov(covT)}<h3>Zranitelnosti</h3>${cov(covW)}
${s.dataDriven ? dataDrivenSection(s.dataDriven) : ""}
${s.appetite ? `<h2>8. Ochota riskovat a klíčové ukazatele rizik</h2>${appetiteSection(s.appetite)}` : ""}`;
}

/** Ochota riskovat a KRI (v1.23, ADR-120) – zpráva o hodnocení rizik i přezkoumání ISMS. */
function appetiteSection(a: RiskAppetiteDto) {
  const L = RISK_APPETITE_LABELS;
  const fmt = (v: number | null, unit: string) => (v == null ? "–" : unit === "pct" ? `${v} %` : String(v));
  const cats = a.categories.filter((c) => c.maxLevel);
  const appr = a.approvedAt ? `Schváleno: ${esc(a.approvedByName ?? "")}, ${day(a.approvedAt)}${a.changedAfterApproval ? " – <b>po schválení změněno, čeká na nové schválení</b>" : ""}.` : "<b>Ochota riskovat nebyla schválena.</b>";
  return `${
    cats.length
      ? `<table><thead><tr><th>Kategorie</th><th>Nejvyšší přijatelná úroveň</th><th>Vyjádření vedení</th></tr></thead><tbody>${cats
          .map((c) => `<tr><td>${esc(L.category[c.key])}</td><td>${lvl(c.maxLevel)}</td><td class="small">${nl(c.statement ?? "")}</td></tr>`)
          .join("")}</tbody></table><p class="small">${appr}</p>`
      : "<p>Ochota riskovat zatím nebyla stanovena.</p>"
  }
<h3>Rizika nad ochotou riskovat</h3>${
    a.breaches.length
      ? `<ul>${a.breaches.map((b) => `<li>${esc(b.code ?? "")} ${esc(b.name)} – ${lvl(b.level)} nad hranicí ${lvl(b.limit)} (${esc(b.categories.map((c) => L.category[c]).join(", "))})${b.treatment ? "" : ", <b>bez zvládání</b>"}</li>`).join("")}</ul>`
      : "<p>Žádné riziko nepřekračuje stanovenou ochotu.</p>"
  }
<h3>Klíčové ukazatele rizik (KRI)</h3><table><thead><tr><th>Ukazatel</th><th class="n">Hodnota</th><th class="n">Varování / překročení</th><th>Stav</th></tr></thead><tbody>${a.kris
    .filter((k) => k.enabled)
    .map((k) => `<tr><td>${esc(L.kri[k.key])}</td><td class="n">${fmt(k.value, k.unit)}</td><td class="n">${k.direction === "min" ? "&lt;" : "≥"} ${fmt(k.warn, k.unit)} / ${fmt(k.alert, k.unit)}</td><td>${k.status === "alert" ? `<b>${esc(L.status[k.status])}</b>${k.breachedSince ? `<br><span class="small">od ${day(k.breachedSince)}</span>` : ""}` : esc(L.status[k.status])}</td></tr>`)
    .join("")}</tbody></table>`;
}

/** 7. Analýza rizik z dat (v1.19, ADR-116) – zmrazený stav ke dni vytvoření zprávy. */
function dataDrivenSection(d: RiskDataReport) {
  const L = RISK_SCENARIO_LABELS;
  const pct = (x: number | null) => (x == null ? "–" : `${Math.round(x * 100)} %`);
  const kinds = (k: string[]) => k.map((x) => RISK_TRIGGER_LABELS.kind[x as RiskTriggerKind] ?? x).join(", ");
  const c = d.coverage;
  const caps = `<table><thead><tr><th>Schopnost</th><th>Stav</th><th>Zdroj</th><th class="n">Pokrytí</th><th>Produkt / poznámka</th></tr></thead><tbody>${d.capabilities
    .map(
      (x) => `<tr><td>${esc(L.capability[x.key])}</td><td>${esc(L.status[x.status])}${x.conflict ? '<br><span class="small">deklarace v rozporu s daty</span>' : ""}</td><td class="small">${esc(L.confidence[x.confidence])}</td><td class="n">${pct(x.coverage)}</td><td class="small">${esc([x.product, x.note].filter(Boolean).join(" – "))}${x.validUntil ? `<br><span class="muted">platnost do ${day(x.validUntil)}</span>` : ""}</td></tr>`,
    )
    .join("")}</tbody></table>`;
  const assetsT = c.assets.length
    ? `<table><thead><tr><th>Primární aktivum</th><th class="n">Riziko</th><th class="n">Návrh</th><th class="n">Nerelevantní</th><th class="n">Neposouzeno</th><th>Neposouzené hrozby</th></tr></thead><tbody>${c.assets
        .map((a) => `<tr><td>${esc(a.name)}</td><td class="n">${a.risk}</td><td class="n">${a.proposed}</td><td class="n">${a.notRelevant}</td><td class="n">${a.unassessed ? `<b>${a.unassessed}</b>` : "0"}</td><td class="small">${esc(a.unassessedCodes.join(", "))}</td></tr>`)
        .join("")}</tbody></table>`
    : "<p>Žádná aktivní primární aktiva.</p>";
  const na = c.notRelevant.length
    ? `<table><thead><tr><th>Aktivum</th><th>Hrozba</th><th>Zdůvodnění</th><th>Posoudil</th></tr></thead><tbody>${c.notRelevant
        .map((x) => `<tr><td>${esc(x.asset)}</td><td class="small">${esc(x.threat)}</td><td>${nl(x.reason)}</td><td class="small">${esc(x.by ?? "")}${x.at ? `<br>${day(x.at)}` : ""}</td></tr>`)
        .join("")}</tbody></table>`
    : "<p>Žádná hrozba nebyla vyloučena jako nerelevantní.</p>";
  const sc = d.scenarios;
  const decided = sc.decided.length
    ? `<table><thead><tr><th>Scénář</th><th>Primární aktivum</th><th>Rozhodnutí</th><th>Riziko / zdůvodnění</th><th>Rozhodl</th></tr></thead><tbody>${sc.decided
        .map(
          (x) => `<tr><td>${esc(x.template)}</td><td>${esc(x.asset)}</td><td>${esc(L.scenarioStatus[x.status])}${x.changed ? '<br><span class="small">data se od rozhodnutí změnila</span>' : ""}</td><td class="small">${esc(x.risk ?? "")}${x.reason ? `${x.risk ? "<br>" : ""}${nl(x.reason)}` : ""}</td><td class="small">${esc(x.by ?? "")}${x.at ? `<br>${day(x.at)}` : ""}</td></tr>`,
        )
        .join("")}</tbody></table>`
    : "<p>Žádný návrh dosud nebyl rozhodnut.</p>";
  const reviews = d.reviews.length
    ? `<table><thead><tr><th>Riziko</th><th>Rozhodnutí</th><th>Podněty</th><th>Zdůvodnění</th><th>Kdo, kdy</th></tr></thead><tbody>${d.reviews
        .map(
          (x) => `<tr><td>${esc(x.risk)}</td><td>${x.decision === "changed" ? `změna hodnocení${x.levelBefore || x.levelAfter ? `<br><span class="small">${lvl(x.levelBefore as RiskLevel | null)} → ${lvl(x.levelAfter as RiskLevel | null)}</span>` : ""}` : "potvrzeno beze změny"}</td><td class="small">${esc(kinds(x.kinds) || "—")}</td><td class="small">${nl(x.note ?? "")}</td><td class="small">${esc(x.by ?? "")}<br>${day(x.at)}</td></tr>`,
        )
        .join("")}</tbody></table>`
    : "<p>V období nebylo zaznamenáno žádné rozhodnutí o přehodnocení.</p>";
  const pending = d.pending.length
    ? `<ul>${d.pending.map((x) => `<li>${esc(x.risk)} – ${esc(kinds(x.kinds))}${x.strong ? " (<b>silný podnět</b>)" : ""}${x.due ? `, rozhodnout do ${day(x.due)}` : ""}</li>`).join("")}</ul>`
    : "<p>Žádné otevřené podněty.</p>";
  return `<h2>7. Analýza rizik z dat</h2>
<p class="small muted">Stav ke dni ${day(d.generatedAt)}. Schopnosti a návrhy scénářů vycházejí z dat evidovaných v CONTIXu (aktiva, zranitelnosti, identity, SOC, BIA a testy plánů, dodavatelé); neznámá schopnost se nepovažuje za zavedenou. Rizika vznikají a mění se jen rozhodnutím odpovědné osoby.</p>
<h3>7.1 Profil bezpečnostních schopností</h3>${caps}
<h3>7.2 Pokrytí katalogu hrozeb u primárních aktiv</h3>
<p>Posouzeno <b>${pct(c.summary.assessedShare)}</b> kombinací aktivum × hrozba (${c.summary.total}; hrozeb v katalogu ${c.threats}): pokryto rizikem ${c.summary.risk}, návrh scénáře ${c.summary.proposed}, nerelevantní se zdůvodněním ${c.summary.not_relevant}, <b>neposouzeno ${c.summary.unassessed}</b>.</p>
${assetsT}
<h3>7.3 Hrozby vyloučené jako nerelevantní</h3>${na}
<h3>7.4 Scénáře z dat a jejich rozhodnutí</h3>
<p>Otevřené návrhy ${sc.counts.proposed}, přijato jako riziko ${sc.counts.accepted}, navázáno na riziko ${sc.counts.linked}, zamítnuto ${sc.counts.rejected}.</p>
${decided}
<h3>7.5 Přehodnocení rizik v období</h3>${reviews}
<h3>7.6 Otevřené podněty k přehodnocení</h3>${pending}${
    d.detection
      ? `<h3>7.7 Pokrytí technik ATT&amp;CK detekcí</h3><p>Technik ze scénářů ${d.detection.summary.total}: zachyceno alerty za 90 dní ${d.detection.summary.detected}, plánované hledání ${d.detection.summary.hunted}, deklarované pravidlo ${d.detection.summary.declared}, <b>slepá místa ${d.detection.summary.blind}</b>.</p>${
          d.detection.blind.length ? `<p class="small">Slepá místa: ${esc(d.detection.blind.join(", "))}</p>` : ""
        }`
      : ""
  }`;
}

/** Varování a upozornění NÚKIB za období s výsledkem posouzení (ADR-088). */
function infoList(items: NonNullable<RiskReportSnapshot["infoItems"]>) {
  const st = (x: (typeof items)[number]) => (x.status ? (INFO_ASSESSMENT_LABELS[x.status] ?? x.status) : "neposouzeno");
  const open = items.filter((x) => !x.status || x.status === "assessing").length;
  return `<ul class="pts">${items
    .map((x) => `<li>${day(x.publishedAt)} – ${x.kind === "warning" ? "<b>varování</b>" : "upozornění na zranitelnost"}: ${esc(x.title)} – ${esc(st(x))}${x.assets ? `, dotčená aktiva ${x.assets}` : ""}${x.note ? ` (${esc(x.note.slice(0, 200))})` : ""}</li>`)
    .join("")}</ul><span class="small muted">z informačního servisu (${items.length}${open ? `, neposouzeno ${open}` : ""})</span>`;
}

function renderPlan(s: PlanSnapshot) {
  const B = s.meta.basis ?? LEGACY_REPORT_BASIS;
  return `<h2>Souhrn</h2><p>Otevřených akcí: <b>${s.totals.open}</b>, dokončených: ${s.totals.done}, po termínu: <b>${s.totals.overdue}</b>,
odhad nákladů otevřených akcí: <b>${s.totals.cost.toLocaleString("cs-CZ")} Kč</b>.</p>
<h2>Akce plánu${esc(refIn(B.id === "cz409" ? "§ 8 odst. 1 písm. g) body 1–7" : B.risk.plan))}</h2>${actionsTable(s.actions)}`;
}

/* ---------- zpráva o přezkoumání ISMS ---------- */

const OBJ_COLOR: Record<ObjectiveStatus, string> = { met: "#0ca30c", partially_met: "#ec835a", not_met: "#d03b3b", not_evaluated: "#b4b2ab", cancelled: "#cbd5e1" };

function renderIsmsReview(s: IsmsReviewSnapshot) {
  const B = s.meta.basis ?? LEGACY_REPORT_BASIS;
  const inp = (key: string) => (s.inputs[key] ? `<div class="assess"><b>Hodnocení:</b><br>${nl(s.inputs[key])}</div>` : `<div class="assess muted">Hodnocení nebylo doplněno.</div>`);
  const title = (key: string) => {
    const i = ISMS_REVIEW_INPUTS.find((x) => x.key === key)!;
    return `${i.point ? `${i.point}. ` : ""}${esc(i.label)}`;
  };
  const off = (m: string) => `<p class="muted small">Modul „${esc(m)}“ není zapnutý – podklad doplňte ručně.</p>`;
  const counts = (o: Record<string, number>, labels: Record<string, string>) =>
    Object.entries(o)
      .filter(([, n]) => n)
      .map(([k, n]) => `${esc(labels[k] ?? k)} ${n}`)
      .join(", ") || "—";

  let body = `<p>${esc(B.review.intro)}
Automaticky převzaté údaje odpovídají stavu evidence CONTIX k datu snímku; hodnocení doplnil zpracovatel.</p>`;

  // 1. cíle
  body += `<h2>${title("objectives")}</h2>`;
  if (!s.objectives.length) body += `<p class="muted">Cíle ISMS nejsou v evidenci vedeny${esc(refIn(B.review.objectives))}.</p>`;
  else
    body += `<table><thead><tr><th>Cíl</th><th>Ukazatel</th><th>Cílová hodnota</th><th>Dosaženo</th><th>Stav</th><th>Odpovědnost</th></tr></thead><tbody>${s.objectives
      .map(
        (o) => `<tr><td>${esc(o.code ?? "")} ${esc(o.title)}${o.evaluation ? `<br><span class="small muted">${nl(o.evaluation)}</span>` : ""}</td><td class="small">${esc(o.metric ?? "")}</td><td>${esc(o.target ?? "")}</td><td>${esc(o.currentValue ?? "")}</td>
<td class="lv"><i style="background:${OBJ_COLOR[o.status]}"></i>${esc(OBJECTIVE_LABELS[o.status])}${o.evaluatedAt ? `<br><span class="small muted">${day(o.evaluatedAt)}</span>` : ""}</td><td class="small">${esc(o.ownerPositionName ?? "")}</td></tr>`,
      )
      .join("")}</tbody></table>`;
  body += inp("objectives");

  // 2. plán zvládání rizik
  body += `<h2>${title("plan")}</h2>`;
  if (!s.plan) body += off("Rizika");
  else {
    body += `<p>Otevřené akce: <b>${s.plan.open}</b>, dokončené: ${s.plan.done}, zrušené: ${s.plan.cancelled}, po termínu: <b>${s.plan.overdue}</b>; odhad nákladů otevřených akcí ${s.plan.cost.toLocaleString("cs-CZ")} Kč.</p>`;
    if (s.plan.overdueActions.length) body += `<h3>Akce po termínu</h3>${actionsTable(s.plan.overdueActions)}`;
  }
  body += inp("plan");

  // 3. stav ISMS
  body += `<h2>${title("state")}</h2>`;
  if (s.risks)
    body += `<h3>Rizika</h3><p>Otevřených rizik ${s.risks.total}: kritických ${s.risks.byLevel.critical}, vysokých ${s.risks.byLevel.high}, středních ${s.risks.byLevel.medium}, nízkých ${s.risks.byLevel.low}, nehodnocených ${s.risks.byLevel.unassessed}.
Nad hranicí akceptovatelnosti ${s.risks.unacceptable}, z toho bez ošetření <b>${s.risks.untreated}</b>. Rizik bez přehodnocení za posledních ${s.risks.reviewMonths} měsíců: <b>${s.risks.notAssessedInPeriod}</b>.</p>`;
  if (s.risks?.reassessment) {
    const ra = s.risks.reassessment;
    body += `<p>Přehodnocení rizik z podnětů (incidenty, zjištění auditů, změny, SOC, zranitelnosti): v období změněno hodnocení ${ra.changed}×, potvrzeno beze změny ${ra.confirmed}×; čeká na rozhodnutí vlastníka <b>${ra.pending}</b>.</p>`;
    if (ra.pendingRisks.length)
      body += `<table style="width:auto"><thead><tr><th>Riziko</th><th class="n">Podněty</th><th>Druh</th></tr></thead><tbody>${ra.pendingRisks
        .map((r) => `<tr><td>${esc(`${r.code ? `${r.code} ` : ""}${r.name}`)}</td><td class="n">${r.triggers}</td><td>${esc(r.kinds.map((k) => RISK_TRIGGER_LABELS.kind[k as RiskTriggerKind] ?? k).join(", "))}</td></tr>`)
        .join("")}</tbody></table>`;
  }
  if (s.compliance.length)
    body += `<h3>Míra shody s bezpečnostními opatřeními</h3><table style="width:auto"><thead><tr><th>Rámec</th><th class="n">Míra shody</th><th class="n">Aplikováno</th><th class="n">Splněno</th><th class="n">Částečně</th><th class="n">Nesplněno</th><th class="n">Neposouzeno</th></tr></thead><tbody>${s.compliance
      .map((c) => `<tr><td>${esc(c.name)}</td><td class="n"><b>${c.score.toLocaleString("cs-CZ")} %</b></td><td class="n">${c.applicable}</td><td class="n">${c.compliant}</td><td class="n">${c.partial}</td><td class="n">${c.nonCompliant}</td><td class="n">${c.notAssessed}</td></tr>`)
      .join("")}</tbody></table>`;
  if (s.controls)
    body += `<p>Opatření v katalogu: ${s.controls.total} – stav zavedení: ${counts(s.controls.byStatus, CONTROL_LABELS.status)}; účinnost: ${counts(s.controls.byEffectiveness, CONTROL_LABELS.effectiveness)}.</p>`;
  body += `<h3>Platné dokumenty ISMS</h3>${
    s.documents.length
      ? `<table style="width:auto"><thead><tr><th>Dokument</th><th class="n">Verze</th><th>Schváleno</th><th class="n">Seznámení</th></tr></thead><tbody>${s.documents
          .map((d) => `<tr><td>${esc(d.title)}</td><td class="n">${d.version}</td><td>${day(d.approvedAt)}</td><td class="n">${d.acknowledgements}</td></tr>`)
          .join("")}</tbody></table>`
      : `<p class="muted">Žádný schválený dokument ISMS v evidenci.</p>`
  }`;
  if (s.continuity) {
    const c = s.continuity;
    body += `<h3>Kontinuita</h3><p>Analýz dopadů: ${c.bia}; platných plánů kontinuity a obnovy: ${c.plans} (schválených ${c.approved}); testů po termínu: <b>${c.testOverdue}</b>; schválených plánů bez testu: ${c.neverTested}.</p>${
      c.lastTests.length
        ? `<table style="width:auto"><thead><tr><th>Plán</th><th>Test</th><th>Výsledek</th><th>RTO</th></tr></thead><tbody>${c.lastTests
            .map((t) => `<tr><td>${esc(t.plan)}</td><td>${day(t.testedAt)}</td><td>${esc(BCM_LABELS.result[t.result as TestResult] ?? t.result)}</td><td>${t.rtoMet == null ? "—" : t.rtoMet ? "splněno" : "<b>nesplněno</b>"}</td></tr>`)
            .join("")}</tbody></table>`
        : ""
    }`;
  }
  if (s.suppliers)
    body += `<h3>Významní dodavatelé${esc(refIn(B.review.suppliers))}</h3><p>Aktivních významných dodavatelů: ${s.suppliers.significant}, s nesplněnými povinnostmi: <b>${s.suppliers.withGaps.length}</b>.</p>${
      s.suppliers.withGaps.length ? `<ul>${s.suppliers.withGaps.map((x) => `<li>${esc(x.name)}: ${x.gaps.map(esc).join(" ")}</li>`).join("")}</ul>` : ""
    }`;
  body += inp("state");

  // 4. audity a kontroly
  body += `<h2>${title("audits")}</h2>`;
  if (s.audits === undefined || s.audits === null) body += off("Audity");
  else {
    const a = s.audits;
    body += a.audits.length
      ? `<table><thead><tr><th>Audit / kontrola</th><th>Dokončeno</th><th>Auditor</th><th class="n">Závažné</th><th class="n">Méně záv.</th><th class="n">Pozorování</th><th>Vedení seznámeno</th></tr></thead><tbody>${a.audits
          .map(
            (x) => `<tr><td>${esc(x.code ?? "")} ${esc(x.title)}<br><span class="small muted">${esc(AUDIT_LABELS.type[x.type as AuditType] ?? x.type)}</span>${x.conclusion ? `<br><span class="small">${nl(x.conclusion)}</span>` : ""}</td><td>${day(x.performedEnd)}</td><td class="small">${esc(x.auditor ?? "")}</td>
<td class="n">${x.findings.major}</td><td class="n">${x.findings.minor}</td><td class="n">${x.findings.observation}</td><td>${x.managementInformedAt ? day(x.managementInformedAt) : "<b>ne</b>"}</td></tr>`,
          )
          .join("")}</tbody></table>`
      : `<p>V hodnoceném období nebyl dokončen žádný audit ani kontrola.</p>`;
    body += `<p>Otevřená zjištění: <b>${a.openFindings}</b> (závažné neshody ${a.openMajor}), nápravná opatření po termínu: <b>${a.overdueFindings}</b>.
Pokrytí oddílů ${B.id === "cz409" ? "vyhl. 409" : "hlavního rámce"} auditem: v posledních 2 letech ${a.coverage.ok} z ${a.coverage.total}, jen v posledních 5 letech ${a.coverage.partial}, neauditováno déle než 5 let nebo nikdy ${a.coverage.overdue}.</p>`;
    if (a.overdueList.length)
      body += `<table><thead><tr><th>Zjištění po termínu</th><th>Audit</th><th>Závažnost</th><th>Termín</th><th>Odpovědnost</th></tr></thead><tbody>${a.overdueList
        .map((f) => `<tr><td>${esc(f.title)}</td><td>${esc(f.audit)}</td><td>${esc(AUDIT_LABELS.severity[f.severity])}</td><td>${day(f.dueDate)}</td><td>${esc(f.owner ?? "")}</td></tr>`)
        .join("")}</tbody></table>`;
  }
  body += inp("audits");

  // 5. předchozí hodnocení
  body += `<h2>${title("previous")}</h2>`;
  if (!s.previous) body += `<p class="muted">Předchozí schválená zpráva o přezkoumání není v evidenci.</p>`;
  else {
    const p = s.previous;
    body += `<p>Verze ${p.version}, schváleno ${day(p.approvedAt)}.</p>${p.conclusions ? `<p><b>Závěry:</b><br>${nl(p.conclusions)}</p>` : ""}${p.updates ? `<p><b>Přijatá rozhodnutí:</b><br>${nl(p.updates)}</p>` : ""}`;
  }
  body += inp("previous");

  // 6. incidenty
  body += `<h2>${title("incidents")}</h2>`;
  if (s.incidents === undefined || s.incidents === null) body += off("Incidenty");
  else {
    const x = s.incidents;
    body += `<p>Evidováno v období: incidentů <b>${x.incidents}</b> (s významným dopadem ${x.significant}, hlášených ${x.reported} z ${x.reportable} podléhajících hlášení), událostí, které nebyly incidentem ${x.events}, neposouzených ${x.unassessed}.
Lhůt hlášení po termínu: <b>${x.overdueReports}</b>. Porušení zabezpečení osobních údajů: ${x.personalData}.</p>`;
    if (x.list.length)
      body += `<table><thead><tr><th>Incident</th><th>Kategorie</th><th>Zjištěno</th><th>Výpadek</th><th>Příčina a poučení</th></tr></thead><tbody>${x.list
        .map(
          (i) => `<tr><td>${esc(i.code ?? "")} ${esc(i.title)}${i.significant ? '<br><span class="small"><b>významný dopad</b></span>' : ""}</td><td>${esc(INCIDENT_LABELS.category[i.category as IncidentCategory] ?? i.category)}</td><td>${day(i.detectedAt)}</td>
<td class="n">${i.downtimeHours != null ? `${i.downtimeHours} h` : "—"}</td><td class="small">${i.rootCause ? nl(i.rootCause) : ""}${i.lessonsLearned ? `<br><span class="muted">${nl(i.lessonsLearned)}</span>` : ""}</td></tr>`,
        )
        .join("")}</tbody></table>`;
  }
  body += inp("incidents");

  // 7. významné změny
  body += `<h2>${title("changes")}</h2>`;
  if (!s.changes) body += off("Řízení ISMS");
  else if (!s.changes.significant.length) body += `<p>V hodnoceném období nebyla evidována žádná významná změna (evidovaných změn celkem ${s.changes.total}).</p>`;
  else
    body += `<p>Evidovaných změn ${s.changes.total}, z toho významných ${s.changes.significant.length}.</p><table><thead><tr><th>Změna</th><th>Stav</th><th>Datum</th><th>Nesplněné kroky${esc(refIn(B.review.changes))}</th></tr></thead><tbody>${s.changes.significant
      .map((c) => `<tr><td>${esc(c.code ?? "")} ${esc(c.title)}</td><td>${esc(CHANGE_LABELS.status[c.status as ChangeStatus] ?? c.status)}</td><td>${day(c.day)}</td><td class="small">${c.gaps.length ? c.gaps.map(esc).join("<br>") : "—"}</td></tr>`)
      .join("")}</tbody></table>`;
  body += inp("changes");

  if (s.infoItems?.length) body += `<h3>Varování a upozornění regulátora</h3>${infoList(s.infoItems)}`;
  if (s.appetite) body += `<h2>Ochota riskovat a klíčové ukazatele rizik</h2>${appetiteSection(s.appetite)}`;
  body += `<h2>${title("conclusions")}</h2>${inp("conclusions")}<h2>${title("updates")}</h2>${inp("updates")}`;
  return body;
}

export function renderDocument(snapshot: Snapshot, info: RenderInfo): string {
  // jazyk výstupu: zatím přeložené jen SoA – ostatní dokumenty celé česky, aby se jazyky nemíchaly
  const t = snapshot.type === "soa" && info.t ? info.t : CS_T;
  outLocale = t.locale === "cs" ? "cs-CZ" : t.locale;
  const body =
    snapshot.type === "soa"
      ? renderSoa(snapshot, info, t)
      : snapshot.type === "risk_report"
        ? renderRiskReport(snapshot, info)
        : snapshot.type === "isms_review"
          ? renderIsmsReview(snapshot)
          : renderPlan(snapshot);
  // název dokumentu podle rámce (ADR-086) – jen u výchozího názvu, vlastní název verze zůstává
  const basisTitle = snapshot.meta.basis?.titles[info.kind];
  const info2 = basisTitle && info.title === docTitle(info.kind, info.framework) ? { ...info, title: basisTitle } : info;
  const out = page(info2, header(snapshot.meta, info2, t) + body + footer(info2, t), t);
  outLocale = "cs-CZ";
  return out;
}

export { docTitle };

/* ---------- sdílené pro další tiskové výstupy (zpráva pro vedení) ---------- */
export const html = { esc, nl, dt, day };
/** Tisková stránka se stylem dokumentů ISMS. */
/** Tisková stránka; `locale` určuje jazyk dokumentu (lang, tlačítko tisku) – ADR-036. */
export function printPage(title: string, body: string, locale = "cs") {
  const lang = locale.replace(/[^A-Za-z-]/g, "") || "cs";
  const btn = formatMessage(lang, BUILTIN_PACKS.find((p) => p.locale === lang)?.messages["print.button"] ?? CS["print.button"]);
  return `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head>
<body><div class="toolbar"><button onclick="window.print()">${esc(btn)}</button></div><div class="page">${body}</div></body></html>`;
}
