import {
  AnswerLibraryInput,
  CustomerQImportOptions,
  QaBulkApprove,
  QaItemPatch,
  TRUST_LABELS,
  bestMatches,
  guessQuestionColumns,
  qaTokens,
  type AnswerLibraryDto,
  type CustomerQDetailDto,
  type CustomerQDto,
  type CustomerQPreviewDto,
  type QaItemDto,
  type QaItemStatus,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, inScope, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { answerLibrary, customerQuestionnaireItems, customerQuestionnaires, users } from "../../db/schema";
import { readTable, writeXlsx } from "../import/table";

/* ============================================================
 * Bezpečnostní dotazníky zákazníků (ADR-099): import XLSX / CSV → otázky; odpovědi z knihovny (shoda ≥ 0,85 se předvyplní
 * jako návrh), z AI (lokální model, `questionnaire_answer`) nebo ručně; každou odpověď schválí člověk; po schválení dotazníku
 * se odpovědi uloží do knihovny. Export do XLSX. Nic se neodesílá – dotazník předává uživatel sám.
 * ============================================================ */

const MAX_ITEMS = 2000;
const AUTO_FILL = 0.85;
export const questionKey = (q: string) => (qaTokens(q).join(" ") || q.toLowerCase().trim()).slice(0, 500);

type QRow = typeof customerQuestionnaires.$inferSelect;

/** Řádky tabulky → otázky (sekce = řádek jen s textem bez otazníku a bez dalších hodnot). Čistá funkce. */
export function questionsFromTable(rows: string[][], lines: number[], cols: { question: number; id: number | null }) {
  const out: { seq: number; sourceRow: number; ref: string | null; section: string | null; question: string }[] = [];
  let section: string | null = null;
  rows.forEach((r, i) => {
    const q = (r[cols.question] ?? "").trim();
    const others = r.filter((c, j) => j !== cols.question && c.trim()).length;
    const ref = cols.id != null ? (r[cols.id] ?? "").trim() || null : null;
    if (!q) {
      // sekce může být v jiném sloupci (např. ID sloupec s nadpisem)
      const only = r.filter((c) => c.trim());
      if (only.length === 1 && only[0]!.length < 120) section = only[0]!.trim();
      return;
    }
    if (others === 0 && !q.includes("?") && q.length < 100 && !ref) {
      section = q;
      return;
    }
    out.push({ seq: out.length + 1, sourceRow: lines[i] ?? i + 2, ref: ref?.slice(0, 100) ?? null, section: section?.slice(0, 300) ?? null, question: q.slice(0, 5000) });
  });
  return out.slice(0, MAX_ITEMS);
}

export function trustQuestionnaireRoutes(db: Db) {
  async function load(c: Context<AppEnv>, id: string) {
    const [q] = await db.select().from(customerQuestionnaires).where(eq(customerQuestionnaires.id, id));
    if (!q) throw new HTTPException(404, { message: "Dotazník nenalezen" });
    assertScope(c, q.companyId, "Dotazník nenalezen");
    return q;
  }
  const write = (c: Context<AppEnv>, companyId: string) => {
    if (!hasPermIn(c, "trust:write", companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
  };
  async function list(where: SQL | undefined): Promise<CustomerQDto[]> {
    const rows = await db
      .select({ q: customerQuestionnaires, by: users.displayName })
      .from(customerQuestionnaires)
      .leftJoin(users, eq(users.id, customerQuestionnaires.approvedById))
      .where(where)
      .orderBy(desc(customerQuestionnaires.createdAt))
      .limit(300);
    const ids = rows.map((r) => r.q.id);
    const counts = ids.length
      ? await db
          .select({ id: customerQuestionnaireItems.questionnaireId, status: customerQuestionnaireItems.status, n: sql<number>`count(*)::int` })
          .from(customerQuestionnaireItems)
          .where(inArray(customerQuestionnaireItems.questionnaireId, ids))
          .groupBy(customerQuestionnaireItems.questionnaireId, customerQuestionnaireItems.status)
      : [];
    return rows.map(({ q, by }) => {
      const cs = { empty: 0, draft: 0, approved: 0 } as Record<QaItemStatus, number>;
      for (const x of counts.filter((k) => k.id === q.id)) cs[x.status] = x.n;
      return { id: q.id, companyId: q.companyId, customer: q.customer, title: q.title, dueDate: q.dueDate, status: q.status, fileName: q.fileName, counts: cs, createdAt: q.createdAt.toISOString(), approvedAt: q.approvedAt?.toISOString() ?? null, approvedByName: by ?? null };
    });
  }
  async function libraryOf(companyId: string) {
    return db.select().from(answerLibrary).where(eq(answerLibrary.companyId, companyId));
  }
  async function detail(q: QRow): Promise<CustomerQDetailDto> {
    const [base] = await list(eq(customerQuestionnaires.id, q.id));
    const rows = await db
      .select({ i: customerQuestionnaireItems, by: users.displayName })
      .from(customerQuestionnaireItems)
      .leftJoin(users, eq(users.id, customerQuestionnaireItems.approvedById))
      .where(eq(customerQuestionnaireItems.questionnaireId, q.id))
      .orderBy(asc(customerQuestionnaireItems.seq));
    const lib = await libraryOf(q.companyId);
    const items: QaItemDto[] = rows.map(({ i, by }) => {
      const m = i.status === "approved" ? null : (bestMatches(i.question, lib, 1, 0.5)[0] ?? null);
      return {
        id: i.id,
        seq: i.seq,
        sourceRow: i.sourceRow,
        ref: i.ref,
        section: i.section,
        question: i.question,
        answer: i.answer,
        answerText: i.answerText,
        sources: i.sources,
        status: i.status,
        confidence: i.confidence,
        answeredBy: i.answeredBy,
        approvedByName: by ?? null,
        libraryMatch: m ? { id: m.id, score: m.score, question: m.question, answer: m.answer, answerText: m.answerText } : null,
      };
    });
    return { ...base!, items };
  }

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "trust"))
      .get("/", requirePerm("trust:read"), async (c) => c.json(await list(inScope(c, customerQuestionnaires.companyId))))
      /** Import dotazníku: náhled (sloupce, ukázka) nebo zápis s předvyplněním z knihovny. */
      .post("/", requirePerm("trust:write"), async (c) => {
        const body = await c.req.parseBody();
        const file = body.file;
        if (!(file instanceof File) || file.size === 0) throw new HTTPException(400, { message: "Chybí soubor (pole „file“)" });
        if (file.size > 10 * 1024 * 1024) throw new HTTPException(413, { message: "Soubor je příliš velký (max. 10 MB)" });
        const field = (k: string) => (typeof body[k] === "string" && body[k] !== "" ? (body[k] as string) : undefined);
        const parsed = CustomerQImportOptions.safeParse({ customer: field("customer") ?? "?", title: field("title"), dueDate: field("dueDate"), sheet: field("sheet"), questionColumn: field("questionColumn"), answerColumn: field("answerColumn"), idColumn: field("idColumn"), mode: field("mode") });
        if (!parsed.success) throw new HTTPException(400, { message: parsed.error.issues[0]?.message ?? "Neplatné volby importu" });
        const o = parsed.data;
        const companyId = targetCompany(c, field("companyId"), "trust:write");
        const buf = new Uint8Array(await file.arrayBuffer());
        let table;
        try {
          table = readTable(buf, file.name, o.sheet);
        } catch (e) {
          throw new HTTPException(400, { message: (e as Error).message });
        }
        const g = guessQuestionColumns(table.headers);
        const qc = o.questionColumn ?? g.question;
        const idc = o.idColumn ?? g.id;
        const preview: CustomerQPreviewDto = { sheets: table.sheets, sheet: table.sheet, headers: table.headers, questionColumn: qc, answerColumn: o.answerColumn ?? g.answer, idColumn: idc, questions: 0, sample: [] };
        if (qc == null || qc >= table.headers.length) {
          if (o.mode === "commit") throw new HTTPException(400, { message: "Vyberte sloupec s otázkami." });
          return c.json(preview);
        }
        const qs = questionsFromTable(table.rows, table.lines, { question: qc, id: idc != null && idc < table.headers.length ? idc : null });
        if (o.mode === "preview") return c.json({ ...preview, questions: qs.length, sample: qs.slice(0, 12).map((x) => ({ ref: x.ref, section: x.section, question: x.question })) });
        if (!qs.length) throw new HTTPException(400, { message: "V souboru nejsou žádné otázky." });
        if (field("customer") == null) throw new HTTPException(400, { message: "Vyplňte zákazníka." });
        const lib = await libraryOf(companyId);
        const me = currentUser(c);
        const id = await db.transaction(async (tx) => {
          const [q] = await tx
            .insert(customerQuestionnaires)
            .values({ companyId, customer: o.customer, title: o.title || file.name, dueDate: o.dueDate ?? null, fileName: file.name.slice(0, 255), fileContent: Buffer.from(buf), sheet: table.sheet, createdById: me.id })
            .returning({ id: customerQuestionnaires.id });
          const values = qs.map((x) => {
            const m = bestMatches(x.question, lib, 1, AUTO_FILL)[0];
            return {
              questionnaireId: q!.id,
              ...x,
              ...(m ? { answer: m.answer, answerText: m.answerText, sources: [{ kind: "library" as const, id: m.id, label: m.question.slice(0, 200) }, ...m.sources], status: "draft" as const, answeredBy: "library" as const, confidence: "high" as const } : {}),
            };
          });
          for (let i = 0; i < values.length; i += 500) await tx.insert(customerQuestionnaireItems).values(values.slice(i, i + 500));
          return q!.id;
        });
        await audit(db, { c, user: me, action: "customer_questionnaire.imported", entityType: "customer_questionnaire", entityId: id, details: { customer: o.customer, file: file.name, questions: qs.length } });
        return c.json(await detail((await load(c, id))), 201);
      })
      .get("/:id", requirePerm("trust:read"), async (c) => c.json(await detail(await load(c, c.req.param("id")))))
      .delete("/:id", requirePerm("trust:write"), async (c) => {
        const q = await load(c, c.req.param("id"));
        write(c, q.companyId);
        await db.delete(customerQuestionnaires).where(eq(customerQuestionnaires.id, q.id));
        await audit(db, { c, user: currentUser(c), action: "customer_questionnaire.deleted", entityType: "customer_questionnaire", entityId: q.id, details: { customer: q.customer, title: q.title } });
        return c.json({ ok: true });
      })
      .patch("/:id/items/:itemId", requirePerm("trust:write"), zValidator("json", QaItemPatch), async (c) => {
        const q = await load(c, c.req.param("id"));
        write(c, q.companyId);
        if (q.status !== "in_progress") throw new HTTPException(409, { message: "Schválený dotazník nelze měnit – vraťte ho do rozpracování." });
        const i = c.req.valid("json");
        const [cur] = await db.select().from(customerQuestionnaireItems).where(and(eq(customerQuestionnaireItems.id, c.req.param("itemId")), eq(customerQuestionnaireItems.questionnaireId, q.id)));
        if (!cur) throw new HTTPException(404, { message: "Položka nenalezena" });
        const next = { ...cur, ...i };
        if (i.status === "approved" && !next.answer && !next.answerText) throw new HTTPException(400, { message: "Schválit lze jen vyplněnou odpověď." });
        const edited = i.answer !== undefined || i.answerText !== undefined;
        const me = currentUser(c);
        await db
          .update(customerQuestionnaireItems)
          .set({
            ...i,
            ...(edited ? { answeredBy: "user" as const, ...(i.status ? {} : { status: next.answer || next.answerText ? ("draft" as const) : ("empty" as const) }) } : {}),
            ...(i.status === "approved" ? { approvedById: me.id, approvedAt: new Date() } : i.status ? { approvedById: null, approvedAt: null } : edited ? { approvedById: null, approvedAt: null } : {}),
            updatedAt: new Date(),
          })
          .where(eq(customerQuestionnaireItems.id, cur.id));
        return c.json(await detail(q));
      })
      /** Převzetí odpovědi z knihovny jako návrh. */
      .post("/:id/items/:itemId/from-library/:libId", requirePerm("trust:write"), async (c) => {
        const q = await load(c, c.req.param("id"));
        write(c, q.companyId);
        const [l] = await db.select().from(answerLibrary).where(and(eq(answerLibrary.id, c.req.param("libId")), eq(answerLibrary.companyId, q.companyId)));
        if (!l) throw new HTTPException(404, { message: "Odpověď v knihovně nenalezena" });
        await db
          .update(customerQuestionnaireItems)
          .set({ answer: l.answer, answerText: l.answerText, sources: [{ kind: "library", id: l.id, label: l.question.slice(0, 200) }, ...l.sources], status: "draft", answeredBy: "library", confidence: "high", approvedById: null, approvedAt: null, updatedAt: new Date() })
          .where(and(eq(customerQuestionnaireItems.id, c.req.param("itemId")), eq(customerQuestionnaireItems.questionnaireId, q.id), ne(customerQuestionnaireItems.status, "approved")));
        return c.json(await detail(q));
      })
      .post("/:id/approve-items", requirePerm("trust:write"), zValidator("json", QaBulkApprove), async (c) => {
        const q = await load(c, c.req.param("id"));
        write(c, q.companyId);
        const me = currentUser(c);
        const r = await db
          .update(customerQuestionnaireItems)
          .set({ status: "approved", approvedById: me.id, approvedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(customerQuestionnaireItems.questionnaireId, q.id), inArray(customerQuestionnaireItems.id, c.req.valid("json").ids), eq(customerQuestionnaireItems.status, "draft")))
          .returning({ id: customerQuestionnaireItems.id });
        await audit(db, { c, user: me, action: "customer_questionnaire.items_approved", entityType: "customer_questionnaire", entityId: q.id, details: { n: r.length } });
        return c.json(await detail(q));
      })
      /** Schválení dotazníku: všechny otázky schválené → odpovědi do knihovny (stejná otázka = aktualizace). */
      .post("/:id/approve", requirePerm("trust:write"), async (c) => {
        const q = await load(c, c.req.param("id"));
        write(c, q.companyId);
        const items = await db.select().from(customerQuestionnaireItems).where(eq(customerQuestionnaireItems.questionnaireId, q.id));
        const open = items.filter((i) => i.status !== "approved").length;
        if (open) throw new HTTPException(409, { message: `Neschválených odpovědí: ${open}.` });
        const me = currentUser(c);
        let saved = 0;
        await db.transaction(async (tx) => {
          for (const i of items) {
            const key = questionKey(i.question);
            await tx
              .insert(answerLibrary)
              .values({ companyId: q.companyId, question: i.question, questionKey: key, answer: i.answer, answerText: i.answerText, sources: i.sources.filter((s) => s.kind !== "library"), usage: 1, updatedById: me.id })
              .onConflictDoUpdate({ target: [answerLibrary.companyId, answerLibrary.questionKey], set: { answer: i.answer, answerText: i.answerText, usage: sql`${answerLibrary.usage} + 1`, updatedById: me.id, updatedAt: new Date() } });
            saved++;
          }
          await tx.update(customerQuestionnaires).set({ status: "approved", approvedById: me.id, approvedAt: new Date(), updatedAt: new Date() }).where(eq(customerQuestionnaires.id, q.id));
        });
        await audit(db, { c, user: me, action: "customer_questionnaire.approved", entityType: "customer_questionnaire", entityId: q.id, details: { library: saved } });
        return c.json(await detail((await load(c, q.id))));
      })
      .post("/:id/reopen", requirePerm("trust:write"), async (c) => {
        const q = await load(c, c.req.param("id"));
        write(c, q.companyId);
        await db.update(customerQuestionnaires).set({ status: "in_progress", approvedById: null, approvedAt: null, updatedAt: new Date() }).where(eq(customerQuestionnaires.id, q.id));
        await audit(db, { c, user: currentUser(c), action: "customer_questionnaire.reopened", entityType: "customer_questionnaire", entityId: q.id });
        return c.json(await detail((await load(c, q.id))));
      })
      .post("/:id/sent", requirePerm("trust:write"), async (c) => {
        const q = await load(c, c.req.param("id"));
        write(c, q.companyId);
        if (q.status !== "approved") throw new HTTPException(409, { message: "Odeslat lze jen schválený dotazník." });
        await db.update(customerQuestionnaires).set({ status: "sent", updatedAt: new Date() }).where(eq(customerQuestionnaires.id, q.id));
        await audit(db, { c, user: currentUser(c), action: "customer_questionnaire.sent", entityType: "customer_questionnaire", entityId: q.id });
        return c.json(await detail((await load(c, q.id))));
      })
      /** Export odpovědí (XLSX) – řádek původního souboru, otázka, odpověď, komentář, zdroje, stav. */
      .get("/:id/export.xlsx", requirePerm("trust:read"), async (c) => {
        const q = await load(c, c.req.param("id"));
        const d = await detail(q);
        const rows = [
          ["Řádek", "ID", "Oddíl", "Otázka", "Odpověď", "Komentář", "Zdroje", "Stav"],
          ...d.items.map((i) => [String(i.sourceRow ?? i.seq), i.ref ?? "", i.section ?? "", i.question, i.answer ? TRUST_LABELS.answer[i.answer] : "", i.answerText ?? "", i.sources.map((s) => s.label).join("; "), TRUST_LABELS.itemStatus[i.status]]),
        ];
        const xlsx = writeXlsx([{ name: "Odpovědi", rows, widths: [8, 10, 24, 60, 12, 60, 40, 14] }]);
        await audit(db, { c, user: currentUser(c), action: "customer_questionnaire.exported", entityType: "customer_questionnaire", entityId: q.id });
        const name = `${q.customer}-${q.title}`.replace(/[^\p{L}\p{N} _.-]+/gu, "_").slice(0, 120) + ".xlsx";
        return new Response(xlsx, {
          headers: {
            "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "content-disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
            "cache-control": "private, no-store",
          },
        });
      })
  );
}

export function answerLibraryRoutes(db: Db) {
  const dto = (l: typeof answerLibrary.$inferSelect): AnswerLibraryDto => ({ id: l.id, question: l.question, answer: l.answer, answerText: l.answerText, tags: l.tags, sources: l.sources, usage: l.usage, updatedAt: l.updatedAt.toISOString() });
  async function load(c: Context<AppEnv>, id: string) {
    const [l] = await db.select().from(answerLibrary).where(eq(answerLibrary.id, id));
    if (!l) throw new HTTPException(404, { message: "Odpověď v knihovně nenalezena" });
    assertScope(c, l.companyId, "Odpověď v knihovně nenalezena");
    if (!hasPermIn(c, "trust:write", l.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
    return l;
  }
  return new Hono<AppEnv>()
    .use("*", requireModule(db, "trust"))
    .get("/", requirePerm("trust:read"), async (c) => {
      const q = c.req.query("q")?.trim();
      const rows = await db.select().from(answerLibrary).where(inScope(c, answerLibrary.companyId)).orderBy(desc(answerLibrary.usage), asc(answerLibrary.question)).limit(2000);
      return c.json((q ? bestMatches(q, rows, 50, 0.2) : rows).map(dto));
    })
    .post("/", requirePerm("trust:write"), zValidator("json", AnswerLibraryInput), async (c) => {
      const i = c.req.valid("json");
      const companyId = targetCompany(c, null, "trust:write");
      const [l] = await db
        .insert(answerLibrary)
        .values({ ...i, companyId, questionKey: questionKey(i.question), updatedById: currentUser(c).id })
        .onConflictDoUpdate({ target: [answerLibrary.companyId, answerLibrary.questionKey], set: { answer: i.answer ?? null, answerText: i.answerText ?? null, tags: i.tags ?? [], updatedAt: new Date() } })
        .returning();
      await audit(db, { c, user: currentUser(c), action: "answer_library.saved", entityType: "answer_library", entityId: l!.id });
      return c.json(dto(l!), 201);
    })
    .put("/:id", requirePerm("trust:write"), zValidator("json", AnswerLibraryInput), async (c) => {
      const prev = await load(c, c.req.param("id"));
      const i = c.req.valid("json");
      const [l] = await db.update(answerLibrary).set({ ...i, questionKey: questionKey(i.question), updatedById: currentUser(c).id, updatedAt: new Date() }).where(eq(answerLibrary.id, prev.id)).returning();
      await audit(db, { c, user: currentUser(c), action: "answer_library.updated", entityType: "answer_library", entityId: prev.id });
      return c.json(dto(l!));
    })
    .delete("/:id", requirePerm("trust:write"), async (c) => {
      const prev = await load(c, c.req.param("id"));
      await db.delete(answerLibrary).where(eq(answerLibrary.id, prev.id));
      await audit(db, { c, user: currentUser(c), action: "answer_library.deleted", entityType: "answer_library", entityId: prev.id });
      return c.json({ ok: true });
    });
}
