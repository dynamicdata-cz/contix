import { bestMatches, parseQaAnswers, type AiItem, type QaAnswerItem, type QaSource } from "@contix/shared";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "../../db/client";
import { answerLibrary, controls, customerQuestionnaireItems, customerQuestionnaires, trustCenters } from "../../db/schema";
import type { PreparedRequest } from "./service";

/* ============================================================
 * Návrh odpovědí na dotazník zákazníka (v1.04, ADR-099): dávka max. 20 nezodpovězených otázek; ke každé kandidáti
 * z knihovny schválených odpovědí, vlastní opatření (podobnost textu) a úryvky platné dokumentace, kterou uživatel
 * smí číst (dohledané v požadavku – `docs`). Model smí citovat jen kandidáty; odpovědi vzniknou jako NÁVRH ke schválení.
 * ============================================================ */

export const QA_BATCH = 20;
export type QaDocs = Map<string, { policyId: string; title: string; heading: string | null; text: string }[]>;
/** Kandidáti podle významu (v1.07): ID záznamů knihovny a opatření k otázce – doplní se k podobnosti slov. */
export type QaSemantic = Map<string, { library: string[]; controls: string[] }>;

/** Nezodpovězené otázky dávky (pro dohledání dokumentace v požadavku). */
export async function qaBatch(db: Db, questionnaireId: string) {
  return db
    .select({ id: customerQuestionnaireItems.id, question: customerQuestionnaireItems.question, section: customerQuestionnaireItems.section, ref: customerQuestionnaireItems.ref })
    .from(customerQuestionnaireItems)
    .where(and(eq(customerQuestionnaireItems.questionnaireId, questionnaireId), eq(customerQuestionnaireItems.status, "empty")))
    .orderBy(asc(customerQuestionnaireItems.seq))
    .limit(QA_BATCH);
}

export async function prepareQuestionnaire(db: Db, qid: string, system: string, note: string, opts: { note?: string; docs?: QaDocs; semantic?: QaSemantic }): Promise<PreparedRequest | null> {
  const [q] = await db.select().from(customerQuestionnaires).where(eq(customerQuestionnaires.id, qid));
  if (!q) return null;
  const batch = await qaBatch(db, qid);
  if (!batch.length) throw new Error("Dotazník nemá nezodpovězené otázky.");
  const lib = await db.select().from(answerLibrary).where(eq(answerLibrary.companyId, q.companyId));
  const ctl = await db
    .select({ id: controls.id, code: controls.code, name: controls.name, description: controls.description, status: controls.status, effectiveness: controls.effectiveness })
    .from(controls)
    .where(and(eq(controls.companyId, q.companyId), ne(controls.status, "not_applicable")));
  const ctlText = ctl.map((c) => ({ ...c, question: `${c.name} ${c.description ?? ""}` }));
  const [tc] = await db.select().from(trustCenters).where(eq(trustCenters.companyId, q.companyId));
  const certs = (tc?.settings.certifications ?? []).map((c, i) => ({ id: `c${i}`, ...c }));
  const known = new Map<string, { question: string; candidates: Map<string, QaSource> }>();
  const questions = batch.map((b) => {
    const cand = new Map<string, QaSource>();
    const sem = opts.semantic?.get(b.id);
    const libHits = bestMatches(b.question, lib, 3, 0.3);
    const ctlHits = bestMatches(b.question, ctlText, 4, 0.15);
    // podle významu nalezené položky (jiná formulace téže otázky) – jen ze záznamů společnosti dotazníku
    for (const id of sem?.library ?? []) if (libHits.length < 5 && !libHits.some((x) => x.id === id)) { const l = lib.find((x) => x.id === id); if (l) libHits.push({ ...l, score: 0.5 }); }
    for (const id of sem?.controls ?? []) if (ctlHits.length < 6 && !ctlHits.some((x) => x.id === id)) { const x = ctlText.find((y) => y.id === id); if (x) ctlHits.push({ ...x, score: 0.5 }); }
    const docs = (opts.docs?.get(b.id) ?? []).slice(0, 2);
    for (const l of libHits) cand.set(`library:${l.id}`, { kind: "library", id: l.id, label: l.question.slice(0, 200) });
    for (const c of ctlHits) cand.set(`control:${c.id}`, { kind: "control", id: c.id, label: `${c.code ? `${c.code} ` : ""}${c.name}`.slice(0, 200) });
    for (const d of docs) cand.set(`policy:${d.policyId}`, { kind: "policy", id: d.policyId, label: d.title.slice(0, 200) });
    for (const c of certs) cand.set(`certification:${c.id}`, { kind: "certification", id: c.id, label: c.name });
    known.set(b.id, { question: b.question, candidates: cand });
    return {
      itemId: b.id,
      ref: b.ref,
      section: b.section,
      question: b.question.slice(0, 1500),
      library: libHits.map((l) => ({ id: l.id, question: l.question.slice(0, 400), answer: l.answer, text: l.answerText?.slice(0, 800) ?? null, similarity: l.score })),
      controls: ctlHits.map((c) => ({ id: c.id, name: `${c.code ? `${c.code} ` : ""}${c.name}`, status: c.status, effectiveness: c.effectiveness, description: c.description?.slice(0, 300) ?? null })),
      documents: docs.map((d) => ({ id: d.policyId, title: d.title, heading: d.heading, excerpt: d.text.slice(0, 900) })),
    };
  });
  const input = { customer: q.customer, certifications: certs.map((c) => ({ id: c.id, name: c.name, issuer: c.issuer, validUntil: c.validUntil, scope: c.scope })), questions };
  const user = [
    "Navrhni odpovědi organizace na bezpečnostní dotazník zákazníka. Odpovídej jen podle podkladů u otázky (library = dříve schválené odpovědi, controls = naše opatření se stavem, documents = úryvky platné dokumentace) a certifications.",
    "answer: yes / no / partial / na; text: stručná věcná odpověď v jazyce otázky (česky nebo anglicky), bez slibů, které podklady nedokládají. Opatření ve stavu planned / in_progress nebo neúčinné = nanejvýš partial.",
    "sources: jen {kind, id} z podkladů otázky (kind library / control / policy / certification). confidence: high jen u shody s knihovnou nebo jasného dokladu. Když podklady chybí, otázku vynech.",
    "Schéma odpovědi:",
    '{"summary": "1–2 věty", "answers": [{"itemId": "…", "answer": "yes", "text": "…", "sources": [{"kind": "policy", "id": "…"}], "confidence": "medium", "reason": "proč"}]}',
    "Podklady (JSON):",
    JSON.stringify(input),
    note,
  ].join("\n");
  return {
    companyId: q.companyId,
    entityType: "customer_questionnaire",
    entityName: `${q.customer}: ${q.title}`,
    input: { customer: q.customer, questions: questions.map((x) => ({ itemId: x.itemId, library: x.library.length, controls: x.controls.length, documents: x.documents.length })), note: opts.note ?? null },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    validate: (raw) => {
      const r = parseQaAnswers(raw, known);
      return { summary: r.summary, items: r.items.map((i) => ({ kind: "qa_answer" as const, ...i })) };
    },
  };
}

/** Přijaté návrhy → odpovědi ve stavu „návrh“ (schvaluje člověk); schválené se nepřepíší. */
export async function applyQuestionnaire(db: Db, qid: string, chosen: AiItem[]) {
  const ids = chosen.filter((x): x is { kind: "qa_answer" } & QaAnswerItem => x.kind === "qa_answer").map((x) => x.itemId);
  if (!ids.length) return { updated: 0 };
  let n = 0;
  for (const it of chosen) {
    if (it.kind !== "qa_answer") continue;
    const r = await db
      .update(customerQuestionnaireItems)
      .set({ answer: it.answer, answerText: it.answerText, sources: it.sources, status: "draft", answeredBy: "ai", confidence: it.confidence, approvedById: null, approvedAt: null, updatedAt: new Date() })
      .where(and(eq(customerQuestionnaireItems.id, it.itemId), eq(customerQuestionnaireItems.questionnaireId, qid), inArray(customerQuestionnaireItems.status, ["empty", "draft"])))
      .returning({ id: customerQuestionnaireItems.id });
    n += r.length;
  }
  return { updated: n };
}
