import { PROJECT_LABELS, PROJECT_LABELS2, type ProjectDetailDto, type Rag } from "@contix/shared";
import { html as h, printPage } from "../documents/render";

/* ============================================================
 * Stavová a závěrečná zpráva projektu (v1.35, ADR-132) – jen podmnožina HTML pro htmlToDocx (h1–h3, p, table, ul, b, br, span.muted).
 * Vše escapované; anglická verze vlastními texty (popisky výčtů přes slovník níže).
 * ============================================================ */

const EN: Record<string, string> = {
  "Stavová zpráva projektu": "Project status report",
  "Závěrečná zpráva projektu": "Project closure report",
  Projekt: "Project",
  Manažer: "Manager",
  Sponzor: "Sponsor",
  Stav: "Status",
  Termín: "Schedule",
  "Datum zprávy": "Report date",
  "Celkový stav": "Overall",
  Harmonogram: "Schedule",
  Rozpočet: "Budget",
  Rozsah: "Scope",
  Shrnutí: "Summary",
  "Co se podařilo": "Achievements",
  "Další kroky": "Next steps",
  "Stav zatím nebyl nahlášen – uveden je návrh z dat projektu.": "No status has been reported yet – a proposal from project data is shown.",
  Fáze: "Phases",
  "Plánovaný konec": "Planned end",
  "Brána schválena": "Gate approved",
  Milníky: "Milestones",
  Splněno: "Done",
  Čerpání: "Spent",
  "Úkoly": "Tasks",
  otevřené: "open",
  "po termínu": "overdue",
  blokované: "blocked",
  hotové: "done",
  "Rizika a problémy": "Risks and issues",
  Druh: "Kind",
  Název: "Title",
  Úroveň: "Level",
  Vlastník: "Owner",
  Opatření: "Response",
  "Žádosti o změnu": "Change requests",
  Změna: "Change",
  "Nový termín": "New end date",
  "Změna rozpočtu": "Budget change",
  Poučení: "Lessons learned",
  "Žádné.": "None.",
  "Tým projektu": "Project team",
  Role: "Role",
  "Vyhodnocení cílů": "Objectives",
  "Popis projektu": "Description",
};

export function projectReportHtml(p: ProjectDetailDto, kind: "status" | "closure", lang: "cs" | "en") {
  const t = (s: string) => (lang === "en" ? (EN[s] ?? s) : s);
  const l = (s: string) => t(s); // popisky výčtů jsou české; v angličtině ponechány, pokud nejsou ve slovníku
  const e = h.esc;
  const day = (d: string | null | undefined) => (d ? h.day(d) : "—");
  const czk = (n: number) => `${Math.round(n).toLocaleString(lang === "en" ? "en-GB" : "cs-CZ")} Kč`;
  const ragTxt = (r: Rag) => (lang === "en" ? { green: "Green", amber: "Amber", red: "Red" }[r] : PROJECT_LABELS2.rag[r]);
  const title = t(kind === "status" ? "Stavová zpráva projektu" : "Závěrečná zpráva projektu");
  const rep = p.reports[0];
  const rag = rep ?? { ...p.suggested, date: null, summary: "", achievements: null, nextSteps: null };
  const rows = (cells: string[][]) => cells.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
  const head = (cells: string[]) => `<tr>${cells.map((c) => `<th>${e(c)}</th>`).join("")}</tr>`;
  const para = (s: string | null) => (s ? `<p>${e(s).replace(/\n/g, "<br>")}</p>` : "");
  let body = `<h1>${e(title)}</h1>
<p><b>${e(t("Projekt"))}:</b> ${e(`${p.code ? `${p.code} ` : ""}${p.name}`)}<br>
<b>${e(t("Manažer"))}:</b> ${e(p.managerName ?? "—")} · <b>${e(t("Sponzor"))}:</b> ${e(p.sponsorName ?? "—")}<br>
<b>${e(t("Stav"))}:</b> ${e(l(PROJECT_LABELS.status[p.status]))} · <b>${e(t("Termín"))}:</b> ${day(p.startDate)} – ${day(p.endDate)}<br>
<b>${e(t("Datum zprávy"))}:</b> ${h.day(new Date().toISOString().slice(0, 10))}</p>`;
  if (kind === "closure" && p.description) body += `<h2>${e(t("Popis projektu"))}</h2>${para(p.description)}`;
  body += `<h2>${e(t("Celkový stav"))}</h2>`;
  if (!rep) body += `<p><span class="muted">${e(t("Stav zatím nebyl nahlášen – uveden je návrh z dat projektu."))}</span></p>`;
  body += `<table>${head([t("Celkový stav"), t("Harmonogram"), t("Rozpočet"), t("Rozsah")])}${rows([[rag.overall, rag.schedule, rag.budget, rag.scope].map((r) => e(ragTxt(r as Rag)))])}</table>`;
  if (rep) {
    body += `<p><span class="muted">${day(rep.date)}${rep.createdByName ? ` · ${e(rep.createdByName)}` : ""}</span></p>`;
    body += `<h3>${e(t("Shrnutí"))}</h3>${para(rep.summary)}`;
    if (rep.achievements) body += `<h3>${e(t("Co se podařilo"))}</h3>${para(rep.achievements)}`;
    if (rep.nextSteps && kind === "status") body += `<h3>${e(t("Další kroky"))}</h3>${para(rep.nextSteps)}`;
  }
  body += `<h2>${e(t("Fáze"))}</h2><table>${head([t("Fáze"), t("Stav"), t("Plánovaný konec"), t("Brána schválena")])}${rows(
    p.phases.map((ph) => [e(l(ph.name)), e(l(PROJECT_LABELS.phase[ph.status])), day(ph.plannedEnd), ph.approvedAt ? `${day(ph.approvedAt.slice(0, 10))}${ph.approvedByName ? ` (${e(ph.approvedByName)})` : ""}` : "—"]),
  )}</table>`;
  if (p.milestones.length)
    body += `<h2>${e(t("Milníky"))}</h2><table>${head([t("Název"), t("Termín"), t("Splněno")])}${rows(p.milestones.map((m) => [e(m.name), day(m.dueDate), m.doneAt ? day(m.doneAt.slice(0, 10)) : "—"]))}</table>`;
  if (p.budget !== null || p.spent) body += `<h2>${e(t("Rozpočet"))}</h2><p>${e(t("Rozpočet"))}: <b>${p.budget !== null ? czk(p.budget) : "—"}</b> · ${e(t("Čerpání"))}: <b>${czk(p.spent)}</b>${p.budget ? ` (${Math.round((p.spent / p.budget) * 100)} %)` : ""}</p>`;
  const open = p.tasks.filter((x) => x.status !== "done");
  body += `<h2>${e(t("Úkoly"))}</h2><p>${open.length} ${e(t("otevřené"))} · ${open.filter((x) => x.overdue).length} ${e(t("po termínu"))} · ${open.filter((x) => x.status === "blocked").length} ${e(t("blokované"))} · ${p.tasks.length - open.length} ${e(t("hotové"))}</p>`;
  const iss = kind === "closure" ? p.issues : p.issues.filter((x) => x.status !== "closed");
  body += `<h2>${e(t("Rizika a problémy"))}</h2>${
    iss.length
      ? `<table>${head([t("Druh"), t("Název"), t("Úroveň"), t("Stav"), t("Vlastník"), t("Opatření")])}${rows(
          iss.map((x) => [e(l(PROJECT_LABELS2.issueKind[x.kind])), e(x.title), e(l(PROJECT_LABELS2.priority[x.level])), e(l(PROJECT_LABELS2.issueStatus[x.status])), e(x.ownerName ?? "—"), x.response ? e(x.response) : "—"]),
        )}</table>`
      : `<p>${e(t("Žádné."))}</p>`
  }`;
  if (p.changes.length)
    body += `<h2>${e(t("Žádosti o změnu"))}</h2><table>${head([t("Změna"), t("Stav"), t("Nový termín"), t("Změna rozpočtu")])}${rows(
      p.changes.map((x) => [`${x.number}. ${e(x.title)}`, e(l(PROJECT_LABELS2.change[x.status])), day(x.newEndDate), x.budgetDelta !== null ? czk(x.budgetDelta) : "—"]),
    )}</table>`;
  if (kind === "closure") {
    if (p.members.length) body += `<h2>${e(t("Tým projektu"))}</h2><table>${head([t("Název"), t("Role"), "RACI"])}${rows(p.members.map((m) => [e(m.name), e(m.role), m.raci]))}</table>`;
    body += `<h2>${e(t("Poučení"))}</h2>`;
    for (const k of ["went_well", "improve"] as const) {
      const ls = p.lessons.filter((x) => x.kind === k);
      body += `<h3>${e(l(PROJECT_LABELS2.lesson[k]))}</h3>${ls.length ? `<ul>${ls.map((x) => `<li>${e(x.text)}</li>`).join("")}</ul>` : `<p>${e(t("Žádné."))}</p>`}`;
    }
  }
  return { title, html: body, page: printPage(`${title} – ${p.name}`, body, lang) };
}
