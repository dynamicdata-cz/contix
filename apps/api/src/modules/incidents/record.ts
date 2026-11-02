import { INCIDENT_LABELS, SOC_ACTION_LABELS, SOC_IOC_LABELS, SOC_LABELS, type IncidentDetail, type IncidentSocEvidence, type Settings, type Translate } from "@contix/shared";
import { html as h } from "../documents/render";
import { CS_T } from "../i18n/service";

/* ============================================================
 * Záznam o zvládání incidentu (ADR-056) – § 14 odst. 1 vyhl. 409/2025: identifikace, klasifikace a povinnost hlásit,
 * dopad, detekce (SOC), podklady, indikátory, opatření a zásahy (kdo navrhl / schválil / provedl), hlášení a lhůty,
 * příčina a poučení, časová osa a nesplněné kroky. Podmnožina HTML pro tisk i Word (`htmlToDocx`).
 * ============================================================ */

export function incidentRecordHtml(d: IncidentDetail, s: Settings, ev: IncidentSocEvidence | null, t: Translate = CS_T) {
  const { esc, nl } = h;
  const L = INCIDENT_LABELS;
  const loc = t.locale === "cs" ? "cs-CZ" : t.locale;
  const dt = (v: string | null | undefined) => (v ? new Date(v).toLocaleString(loc, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Prague" }) : "—");
  const yn = (v: boolean) => esc(v ? t("srv.inc.yes") : t("srv.inc.no"));
  const txt = (v: string | null | undefined) => (v?.trim() ? nl(v) : `<span class="muted">${esc(t("srv.inc.notStated"))}</span>`);
  const row = (k: string, v: string) => `<tr><th style="width:30%">${esc(k)}</th><td>${v}</td></tr>`;
  const title = t("srv.incRec.title");
  const code = `${d.code ? `${d.code} ` : ""}${d.title}`;
  const parts: string[] = [];
  parts.push(`<div class="muted small">${esc(s.organizationName)}${s.organizationIco ? `, IČO ${esc(s.organizationIco)}` : ""}</div>
<h1>${esc(title)}</h1>
<div class="muted">${esc(t("srv.incRec.basis"))}</div>
<div class="meta"><span class="muted">${esc(t("srv.incRec.incident"))}</span><span>${esc(code)}</span><span class="muted">${esc(t("srv.incRec.generated"))}</span><span>${esc(dt(new Date().toISOString()))}</span></div>`);
  if (d.gaps.length) parts.push(`<h2>${esc(t("srv.incRec.hGaps"))}</h2><ul>${d.gaps.map((g) => `<li>${esc(t.lbl(g))}</li>`).join("")}</ul>`);
  // 1) identifikace
  parts.push(`<h2>1. ${esc(t("srv.incRec.hIdent"))}</h2><table><tbody>
${row(t("srv.inc.designation"), esc(code))}
${row(t("srv.incRec.kindStatus"), `${esc(t.lbl(L.kind[d.kind]))} · ${esc(t.lbl(L.status[d.status]))}`)}
${row(t("srv.inc.category"), esc(t.lbl(L.category[d.category])))}
${row(t("srv.incRec.owner"), esc(d.ownerPositionName ?? "—"))}
${row(t("srv.incRec.reportedBy"), esc(d.reportedBy ?? "—"))}
${row(t("srv.inc.occurredAt"), esc(dt(d.occurredAt)))}
${row(t("srv.inc.detectedAt"), esc(dt(d.detectedAt)))}
${row(t("srv.inc.resolvedAt"), esc(dt(d.resolvedAt)))}
${row(t("srv.inc.description"), txt(d.description))}
</tbody></table>`);
  // 2) klasifikace a povinnost hlásit
  parts.push(`<h2>2. ${esc(t("srv.incRec.hClass"))}</h2><table><tbody>
${row(t("srv.incRec.reportable"), `${yn(d.reportable)}${d.regime !== "none" ? ` (${esc(t(d.regime === "higher" ? "srv.incRec.regimeHigher" : d.regime === "nis2" ? "srv.incRec.regimeNis2" : d.regime === "dora" ? "srv.incRec.regimeDora" : "srv.incRec.regimeLower"))})` : ""}`)}
${row(t("srv.inc.significance"), `${esc(d.significant ? t("srv.inc.significant") : t("srv.inc.notSignificant"))}${d.significanceNote ? ` – ${nl(d.significanceNote)}` : ""}`)}
${row(t("srv.incRec.tolerance"), txt(d.tolerance))}
${row(t("srv.inc.suspectedUnlawful"), yn(d.suspectedUnlawful))}
${row(t("srv.inc.crossBorder"), yn(d.crossBorder))}
${row(t("srv.incRec.gdpr"), yn(d.personalDataBreach))}
</tbody></table>`);
  // 3) dopad a dotčené záznamy
  parts.push(`<h2>3. ${esc(t("srv.incRec.hImpact"))}</h2><table><tbody>
${row(t("srv.inc.impact"), txt(d.impactDescription))}
${row(t("srv.inc.affectedUsers"), d.affectedUsers == null ? "—" : String(d.affectedUsers))}
${row(t("srv.inc.downtime"), d.downtimeHours == null ? "—" : String(d.downtimeHours))}
${row(t("srv.inc.financialLoss"), d.financialLoss == null ? "—" : d.financialLoss.toLocaleString(loc))}
${row(t("srv.inc.affectedAssets"), esc(d.assets.map((a) => a.name).join(", ") || "—"))}
${row(t("srv.incRec.processes"), esc(d.processes.map((p) => `${p.code ?? ""} ${p.name}`.trim()).join(", ") || "—"))}
${row(t("srv.incRec.suppliers"), esc(d.suppliers.map((x) => x.name).join(", ") || "—"))}
${row(t("srv.incRec.risks"), esc(d.risks.map((r) => `${r.code ?? ""} ${r.name}`.trim()).join(", ") || "—"))}
</tbody></table>`);
  // 4) detekce – SOC
  if (ev?.alerts.length)
    parts.push(`<h2>4. ${esc(t("srv.incRec.hDetect"))}</h2>
<p class="small muted">${esc(t("srv.incRec.detectNote", { from: dt(ev.firstSeen), to: dt(ev.lastSeen), mitre: ev.techniques.join(", ") || "—" }))}</p>
<table><thead><tr><th>${esc(t("srv.incRec.colAlert"))}</th><th>${esc(t("srv.incRec.colSource"))}</th><th>${esc(t("srv.incRec.colHost"))}</th><th>${esc(t("srv.incRec.colWhen"))}</th></tr></thead><tbody>
${ev.alerts.map((a) => `<tr><td>${esc(a.title)}${a.caseCode ? ` <span class="muted">(${esc(a.caseCode)})</span>` : ""}<br><span class="small muted">${esc(t.lbl(SOC_LABELS.severity[a.severity]))} · ${esc(a.mitreIds.join(", "))}</span></td><td>${esc(t.lbl(SOC_LABELS.source[a.source] ?? a.source))}<br><span class="small muted">${esc(a.ruleId)}</span></td><td>${esc(a.agentName ?? "—")}</td><td>${esc(`${a.count}× ${dt(a.firstSeen)} – ${dt(a.lastSeen)}`)}</td></tr>`).join("")}
</tbody></table>`);
  // 5) podklady a indikátory
  parts.push(`<h2>5. ${esc(t("srv.incRec.hEvidence"))}</h2><table><tbody>
${row(t("srv.incRec.evidence"), txt(d.evidence))}
${row(t("srv.inc.indicators"), txt(d.indicators))}
</tbody></table>`);
  if (ev?.iocs.length)
    parts.push(`<table><thead><tr><th>${esc(t("srv.incRec.colIocType"))}</th><th>${esc(t("srv.incRec.colIocValue"))}</th><th>${esc(t("srv.incRec.colIocAction"))}</th></tr></thead><tbody>
${ev.iocs.map((i) => `<tr><td>${esc(t.lbl(SOC_IOC_LABELS.type[i.type]))}</td><td>${esc(i.display)}</td><td>${esc(t.lbl(SOC_IOC_LABELS.action[i.action]))} · ${esc(t.lbl(SOC_IOC_LABELS.state[i.state]))}</td></tr>`).join("")}
</tbody></table>`);
  // 6) opatření a zásahy
  parts.push(`<h2>6. ${esc(t("srv.incRec.hContain"))}</h2><table><tbody>${row(t("srv.inc.containment"), txt(d.containment))}</tbody></table>`);
  if (ev?.actions.length)
    parts.push(`<table><thead><tr><th>${esc(t("srv.incRec.colAction"))}</th><th>${esc(t("srv.incRec.colProposed"))}</th><th>${esc(t("srv.incRec.colDecided"))}</th><th>${esc(t("srv.incRec.colExecuted"))}</th></tr></thead><tbody>
${ev.actions
  .map(
    (a) => `<tr><td><b>${esc(t.lbl(SOC_ACTION_LABELS.kind[a.kind]))}</b> ${esc(a.target)}<br><span class="small">${esc(t.lbl(SOC_ACTION_LABELS.status[a.status]))}</span><br><span class="small muted">${esc(a.reason)}</span></td>
<td>${esc(a.requestedByName ?? "—")}<br><span class="small muted">${esc(dt(a.createdAt))}</span></td>
<td>${esc(a.decidedByName ?? "—")}<br><span class="small muted">${esc(dt(a.decidedAt))}${a.decisionNote ? ` – ${esc(a.decisionNote)}` : ""}</span></td>
<td>${esc(a.executedByName ?? "—")}<br><span class="small muted">${esc(dt(a.executedAt))}</span>${a.result ? `<br><span class="small">${esc(a.result)}</span>` : ""}</td></tr>`,
  )
  .join("")}
</tbody></table>`);
  // 7) hlášení a lhůty
  parts.push(`<h2>7. ${esc(t("srv.incRec.hReports"))}</h2>${
    d.deadlines.length
      ? `<table><thead><tr><th>${esc(t("srv.incRec.colReport"))}</th><th>${esc(t("srv.incRec.colDue"))}</th><th>${esc(t("srv.incRec.colSubmitted"))}</th></tr></thead><tbody>${d.deadlines
          .map((x) => `<tr><td>${esc(x.label)}<br><span class="small muted">${esc(x.legal)}</span></td><td>${esc(dt(x.due))}</td><td>${x.submittedAt ? esc(dt(x.submittedAt)) : `<b>${esc(t(x.state === "overdue" ? "srv.incRec.overdue" : "srv.incRec.notYet"))}</b>`}</td></tr>`)
          .join("")}</tbody></table>`
      : `<p class="muted">${esc(t("srv.incRec.noReporting"))}</p>`
  }${
    d.reports.length
      ? `<table><thead><tr><th>${esc(t("srv.incRec.colReport"))}</th><th>${esc(t("srv.incRec.colRecipient"))}</th><th>${esc(t("srv.incRec.colSubmitted"))}</th></tr></thead><tbody>${d.reports
          .map((r) => `<tr><td>${esc(t.lbl(L.reportType[r.reportType]))}${r.reference ? `<br><span class="small muted">${esc(r.reference)}</span>` : ""}</td><td>${esc(t.lbl(L.recipient[r.recipient]))} · ${esc(t.lbl(L.channel[r.channel]))}</td><td>${esc(dt(r.submittedAt))}${r.createdByName ? `<br><span class="small muted">${esc(r.createdByName)}</span>` : ""}</td></tr>`)
          .join("")}</tbody></table>`
      : ""
  }`);
  // 8) příčina a poučení
  parts.push(`<h2>8. ${esc(t("srv.incRec.hCause"))}</h2><table><tbody>
${row(t("srv.inc.cause"), `${esc(t.lbl(L.cause[d.cause]))}${d.rootCause ? `<br>${nl(d.rootCause)}` : ""}`)}
${row(t("srv.inc.lessons"), txt(d.lessonsLearned))}
</tbody></table>`);
  // 9) časová osa
  parts.push(`<h2>9. ${esc(t("srv.inc.hTimeline"))}</h2>${
    d.timeline.length
      ? `<table><tbody>${[...d.timeline]
          .sort((a, b) => a.at.localeCompare(b.at))
          .map((x) => `<tr><th style="width:24%">${esc(dt(x.at))}</th><td>${nl(x.text)}</td></tr>`)
          .join("")}</tbody></table>`
      : `<p class="muted">${esc(t("srv.inc.noEntries"))}</p>`
  }`);
  return { title: `${title} ${d.code ?? ""}`.trim(), org: s.organizationName, html: parts.join("\n") };
}
