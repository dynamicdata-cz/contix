import { SOC2_SCOPE_CATEGORIES, parseReportItems, soc2CriteriaFor, type AiItem } from "@contix/shared";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { controls, supplierReportItems, supplierReports, suppliers } from "../../db/schema";
import type { PreparedRequest } from "./service";

/* ============================================================
 * Vytěžení zprávy o ujištění dodavatele (v1.03, ADR-098): z textu zprávy (lokální model) CUEC s návrhem vlastního
 * opatření, výjimky z testování s odpovědí vedení a kontroly subdodavatelů (CSOC). Do modelu jde jen výňatek zprávy
 * a názvy vlastních opatření (bez osob); ID opatření a kritéria se ověří; položky vzniknou jen po přijetí.
 * ============================================================ */

const KEYWORDS = /complementary user entity|user entity control|\bCUECs?\b|complementary subservice|\bCSOCs?\b|subservice organi[sz]ation|carve[- ]?out|exceptions? noted|deviations?|not operating effectively|qualified opinion|management'?s response|doplňkov|výjimk|odchylk/gi;
const WINDOW = 2500;
const MAX = 24_000;

/** Výňatek zprávy kolem klíčových míst (CUEC, výjimky, subdodavatelé); bez shody začátek textu. Čistá funkce. */
export function reportExcerpt(text: string, max = MAX): string {
  const spans: [number, number][] = [];
  for (const m of text.matchAll(KEYWORDS)) {
    const a = Math.max(0, m.index! - 300);
    const b = Math.min(text.length, m.index! + WINDOW);
    const last = spans.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else spans.push([a, b]);
  }
  if (!spans.length) return text.slice(0, max);
  let out = "";
  for (const [a, b] of spans) {
    const part = text.slice(a, b);
    if (out.length + part.length + 5 > max) {
      out += `\n…\n${part.slice(0, Math.max(0, max - out.length - 5))}`;
      break;
    }
    out += (out ? "\n…\n" : "") + part;
  }
  return out.slice(0, max);
}

export async function prepareSupplierReport(db: Db, reportId: string, system: string, note: string, opts: { note?: string }): Promise<PreparedRequest | null> {
  const [r] = await db.select({ r: supplierReports, supplier: suppliers.name }).from(supplierReports).innerJoin(suppliers, eq(suppliers.id, supplierReports.supplierId)).where(eq(supplierReports.id, reportId));
  if (!r) return null;
  if (!r.r.text || r.r.text.trim().length < 50) throw new Error("Zpráva nemá text – nahrajte PDF (převodní služba) nebo vložte text zprávy.");
  const own = await db.select({ id: controls.id, code: controls.code, name: controls.name }).from(controls).where(eq(controls.companyId, r.r.companyId)).orderBy(asc(controls.code)).limit(250);
  const existing = await db.select({ kind: supplierReportItems.kind, text: supplierReportItems.text }).from(supplierReportItems).where(eq(supplierReportItems.reportId, r.r.id));
  const criteria = new Set(soc2CriteriaFor([...SOC2_SCOPE_CATEGORIES]).map((c) => c.id.toUpperCase()));
  const input = {
    report: { supplier: r.supplier, kind: r.r.kind, title: r.r.title, period: [r.r.periodFrom, r.r.periodTo].filter(Boolean).join(" – ") || r.r.asOf, auditor: r.r.serviceAuditor },
    ownControls: own.map((c) => ({ controlId: c.id, name: `${c.code ? `${c.code} ` : ""}${c.name}` })),
    alreadyRecorded: existing.map((e) => ({ kind: e.kind, text: e.text.slice(0, 160) })),
  };
  const user = [
    "Z výňatku zprávy o ujištění dodavatele (SOC 2 / SOC 1 / ISAE 3402) vytěž:",
    "cuecs = doplňkové kontroly na straně uživatele (Complementary User Entity Controls) – co musíme zajistit my; ke každé navrhni controlId z ownControls, které ji pokrývá (jinak null);",
    "exceptions = výjimky / odchylky zjištěné při testování (kontrola, kritérium jako CC6.1, popis odchylky, odpověď vedení dodavatele, závažnost low/medium/high podle dopadu na nás);",
    "csocs = kontroly vyňatých subdodavatelů (Complementary Subservice Organization Controls, carve-out).",
    "Text formuluj česky, stručně, věrně zprávě. Necituj delší pasáže. Vynech položky z alreadyRecorded. Když něco ve výňatku není, vrať prázdný seznam.",
    "Schéma odpovědi:",
    '{"summary": "1–3 věty o výroku a hlavních zjištěních", "cuecs": [{"ref": "CUEC-1", "text": "…", "criterion": "CC6.1", "controlId": "…", "reason": "proč toto opatření"}], "exceptions": [{"ref": "CC7.2", "criterion": "CC7.2", "text": "…", "managementResponse": "…", "severity": "medium", "reason": "…"}], "csocs": [{"text": "…", "criterion": "CC6.4"}]}',
    "Podklady (JSON):",
    JSON.stringify(input),
    "Výňatek zprávy:",
    reportExcerpt(r.r.text),
    note,
  ].join("\n");
  const cm = new Map(input.ownControls.map((c) => [c.controlId, c.name]));
  return {
    companyId: r.r.companyId,
    entityType: "supplier_report",
    entityName: `${r.supplier}: ${r.r.title}`,
    input: { ...input, excerptChars: Math.min(MAX, r.r.text.length), note: opts.note ?? null },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    validate: (raw) => {
      const p = parseReportItems(raw, cm, criteria);
      return { summary: p.summary, items: p.items.map((i) => ({ kind: "report_item" as const, ...i })) };
    },
  };
}

/** Přijaté položky → `supplier_report_items` (zdroj ai, stav k posouzení). */
export async function applySupplierReport(db: Db, reportId: string, chosen: AiItem[]) {
  const [r] = await db.select({ companyId: supplierReports.companyId }).from(supplierReports).where(eq(supplierReports.id, reportId));
  if (!r) return { created: 0 };
  let created = 0;
  for (const it of chosen) {
    if (it.kind !== "report_item") continue;
    let controlId = it.controlId;
    if (controlId) {
      const [ctl] = await db.select({ id: controls.id }).from(controls).where(and(eq(controls.id, controlId), eq(controls.companyId, r.companyId)));
      if (!ctl) controlId = null;
    }
    await db.insert(supplierReportItems).values({
      reportId,
      kind: it.itemKind,
      ref: it.ref,
      text: it.text,
      criterion: it.criterion,
      controlId,
      severity: it.severity,
      managementResponse: it.managementResponse,
      note: it.reason ? `AI: ${it.reason}`.slice(0, 2000) : null,
      source: "ai",
    });
    created++;
  }
  return { created };
}
