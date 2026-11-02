import {
  BUILTIN_RISK_METHODOLOGY,
  QUESTIONNAIRE_FILE_MAX_BYTES,
  QUESTIONNAIRE_FILES_MAX,
  QUESTIONNAIRE_FILES_TOTAL_MAX,
  QUESTIONNAIRE_LABELS,
  questionnaireFileAllowed,
  type QuestionnaireFileDto,
  QUESTIONNAIRE_PUBLIC_TEXT,
  QUESTIONNAIRE_SECTIONS,
  QuestionnaireCreateInput,
  QuestionnaireEvaluateInput,
  QuestionnaireSaveInput,
  QuestionnaireSubmitInput,
  questionnaireExpired,
  questionsFor,
  scoreQuestionnaire,
  type PublicQuestionnaireDto,
  type QuestionnaireDto,
  type QuestionnaireLocale,
  type QuestionnaireStatus,
  type QuestionnaireTemplate,
  type Translate,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { currentUser, hasPerm, requireModule, requirePerm } from "../../auth/middleware";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import { assertScope, settingsFor } from "../../auth/scope";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { companies, riskCatalog, risks, supplierQuestionnaireFiles, supplierQuestionnaires, supplierRisks, suppliers, users } from "../../db/schema";
import { safeFilename } from "../assurance/routes";
import { mimeFor } from "../policies/mime";
import { ApiError } from "../../lib/apiError";
import { html, printPage } from "../documents/render";
import { CS_T, tFor, translatorFor } from "../i18n/service";
import { getNotificationSettings, smtpMailer, type Mailer } from "../notifications/service";

/* ============================================================
 * Bezpečnostní dotazníky pro dodavatele (ADR-040).
 * Odkaz pro dodavatele nese náhodný token (32 B), v DB je jen SHA-256 – token se ukáže jen při vytvoření / obnovení odkazu.
 * Vyhodnocení i založení rizika dělá jen uživatel; nic se neaplikuje automaticky.
 * ============================================================ */

type Ctx = Context<AppEnv>;
type Row = typeof supplierQuestionnaires.$inferSelect;
type Deps = { db: Db; config: Config; mailer?: Mailer };

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
};
export const questionnaireLink = (config: Config, token: string) => `${config.APP_URL.replace(/\/$/, "")}/q/${token}`;

const evaluator = alias(users, "sq_evaluator");
const creator = alias(users, "sq_creator");

function dto(r: Row, names: { evaluatedBy: string | null; createdBy: string | null }, files: QuestionnaireFileDto[] = []): QuestionnaireDto {
  const template = (r.template === "cz410" ? "cz410" : "cz409") as QuestionnaireTemplate;
  const status = r.status as QuestionnaireStatus;
  return {
    id: r.id,
    supplierId: r.supplierId,
    companyId: r.companyId,
    title: r.title,
    template,
    locale: (r.locale === "en" ? "en" : "cs") as QuestionnaireLocale,
    status,
    expired: questionnaireExpired({ status, expiresAt: r.expiresAt.toISOString() }),
    expiresAt: r.expiresAt.toISOString(),
    sentAt: r.sentAt.toISOString(),
    sentTo: r.sentTo,
    message: r.message,
    submittedAt: r.submittedAt?.toISOString() ?? null,
    respondentName: r.respondentName,
    respondentEmail: r.respondentEmail,
    respondentRole: r.respondentRole,
    generalNote: r.generalNote,
    answers: r.answers,
    result: scoreQuestionnaire(template, r.answers),
    evaluatedAt: r.evaluatedAt?.toISOString() ?? null,
    evaluatedByName: names.evaluatedBy,
    evaluationNote: r.evaluationNote,
    riskId: r.riskId,
    createdByName: names.createdBy,
    lastSavedAt: r.lastSavedAt?.toISOString() ?? null,
    files,
  };
}

/** Seznam příloh (bez obsahu) pro dotazníky. */
async function filesOf(db: Db, ids: string[]): Promise<Map<string, QuestionnaireFileDto[]>> {
  const out = new Map<string, QuestionnaireFileDto[]>();
  if (!ids.length) return out;
  const rows = await db
    .select({ id: supplierQuestionnaireFiles.id, qid: supplierQuestionnaireFiles.questionnaireId, questionKey: supplierQuestionnaireFiles.questionKey, filename: supplierQuestionnaireFiles.filename, size: supplierQuestionnaireFiles.size, uploadedAt: supplierQuestionnaireFiles.uploadedAt })
    .from(supplierQuestionnaireFiles)
    .where(inArray(supplierQuestionnaireFiles.questionnaireId, ids))
    .orderBy(asc(supplierQuestionnaireFiles.uploadedAt));
  for (const r of rows) {
    const list = out.get(r.qid) ?? [];
    list.push({ id: r.id, questionKey: r.questionKey, filename: r.filename, size: r.size, uploadedAt: r.uploadedAt.toISOString() });
    out.set(r.qid, list);
  }
  return out;
}

async function loadList(db: Db, where: ReturnType<typeof and>) {
  const rows = await db
    .select({ q: supplierQuestionnaires, ev: evaluator.displayName, cr: creator.displayName })
    .from(supplierQuestionnaires)
    .leftJoin(evaluator, eq(evaluator.id, supplierQuestionnaires.evaluatedById))
    .leftJoin(creator, eq(creator.id, supplierQuestionnaires.createdById))
    .where(where)
    .orderBy(desc(supplierQuestionnaires.sentAt));
  const files = await filesOf(db, rows.map((r) => r.q.id));
  return rows.map((r) => dto(r.q, { evaluatedBy: r.ev, createdBy: r.cr }, files.get(r.q.id) ?? []));
}

/** Text otázky v jazyce uživatele (čeština / angličtina). */
const qText = (t: Translate, key: string) => {
  const q = questionsFor("cz409").find((x) => x.key === key);
  return q ? (t.locale === "en" ? q.text.en : q.text.cs) : key;
};
const secTitle = (t: Translate, key: string) => {
  const s = QUESTIONNAIRE_SECTIONS.find((x) => x.key === key);
  return s ? (t.locale === "en" ? s.title.en : s.title.cs) : key;
};

/** Tisková zpráva s odpověďmi dodavatele (podklad k hodnocení rizik dodavatele). */
export function questionnaireReportHtml(q: QuestionnaireDto, supplierName: string, t: Translate = CS_T) {
  const e = html.esc;
  const dt = (v: string | null) => (v ? new Date(v).toLocaleString(t.locale === "cs" ? "cs-CZ" : t.locale) : "—");
  const r = q.result;
  const rows = questionsFor(q.template)
    .map((x) => {
      const a = q.answers[x.key];
      const fl = q.files.filter((f) => f.questionKey === x.key).map((f) => e(f.filename));
      return `<tr><td>${e(secTitle(t, x.section))}</td><td>${e(qText(t, x.key))}${x.critical ? ` <span class="muted">(${e(t("srv.sq.critical"))})</span>` : ""}</td><td>${a ? e(t.lbl(QUESTIONNAIRE_LABELS.answer[a.value])) : "—"}</td><td>${e(a?.comment ?? "")}${a?.evidence ? `<br><span class="muted">${e(a.evidence)}</span>` : ""}${fl.length ? `<br><span class="muted">${e(t("srv.sq.files"))}: ${fl.join(", ")}</span>` : ""}</td></tr>`;
    })
    .join("");
  const body = `<h1>${e(t("srv.sq.reportTitle"))}</h1>
<p class="muted">${e(supplierName)} · ${e(q.title)}</p>
<div class="meta"><div>${e(t("srv.sq.respondent"))}</div><div>${e([q.respondentName, q.respondentRole, q.respondentEmail].filter(Boolean).join(", ") || "—")}</div>
<div>${e(t("srv.sq.submitted"))}</div><div>${e(dt(q.submittedAt))}</div>
<div>${e(t("srv.sq.score"))}</div><div>${r.score == null ? "—" : `${r.score} %`}${r.level ? ` · ${e(t("srv.sq.suggestedLevel"))}: ${e(t.lbl(QUESTIONNAIRE_LABELS.level[r.level]))}` : ""}</div>
<div>${e(t("srv.sq.evaluated"))}</div><div>${e(q.evaluatedAt ? `${dt(q.evaluatedAt)}${q.evaluatedByName ? ` · ${q.evaluatedByName}` : ""}` : "—")}</div></div>
${q.evaluationNote ? `<p>${e(q.evaluationNote)}</p>` : ""}
<h2>${e(t("srv.sq.answers"))}</h2>
<table><thead><tr><th>${e(t("srv.sq.section"))}</th><th>${e(t("srv.sq.question"))}</th><th>${e(t("srv.sq.answer"))}</th><th>${e(t("srv.sq.comment"))}</th></tr></thead><tbody>${rows}</tbody></table>
${q.generalNote ? `<h3>${e(t("srv.sq.generalNote"))}</h3><p>${e(q.generalNote)}</p>` : ""}
${q.files.some((f) => !f.questionKey) ? `<h3>${e(t("srv.sq.files"))}</h3><ul>${q.files.filter((f) => !f.questionKey).map((f) => `<li>${e(f.filename)}</li>`).join("")}</ul>` : ""}`;
  return printPage(`${t("srv.sq.reportTitle")} – ${supplierName}`, body, t.locale);
}

/** Interní API (pod /suppliers, vyžaduje přihlášení). */
export function questionnaireRoutes(deps: Deps) {
  const { db, config } = deps;

  async function supplierOf(c: Ctx, id: string) {
    const [s] = await db.select().from(suppliers).where(eq(suppliers.id, id));
    if (!s) throw new ApiError(404, "err.sq.supplierNotFound");
    assertScope(c, s.companyId, "Dodavatel nenalezen");
    return s;
  }
  async function rowOf(c: Ctx, supplierId: string, qid: string) {
    const s = await supplierOf(c, supplierId);
    const [r] = await db.select().from(supplierQuestionnaires).where(and(eq(supplierQuestionnaires.id, qid), eq(supplierQuestionnaires.supplierId, s.id)));
    if (!r) throw new ApiError(404, "err.sq.notFound");
    return { s, r };
  }
  const one = async (id: string) => (await loadList(db, eq(supplierQuestionnaires.id, id)))[0]!;

  /** Odeslání odkazu e-mailem (v jazyce dotazníku). Vrací chybu jako text – dotazník vznikne i bez e-mailu. */
  async function sendLink(to: string, link: string, locale: QuestionnaireLocale, org: string, supplierName: string, expiresAt: Date, message: string | null) {
    const s = await getNotificationSettings(db);
    if (!s.smtpHost || !s.smtpFrom) return "smtp";
    const L = QUESTIONNAIRE_PUBLIC_TEXT[locale];
    const date = expiresAt.toLocaleDateString(locale === "cs" ? "cs-CZ" : "en-GB");
    const intro = L.intro!.replace("{organization}", org).replace("{date}", date);
    const subject = `${L.heading} – ${org}`;
    const text = `${intro}\n\n${L.supplier}: ${supplierName}\n${message ? `\n${message}\n` : ""}\n${link}\n`;
    const e = html.esc;
    const body = `<p>${e(intro)}</p><p>${e(L.supplier!)}: <b>${e(supplierName)}</b></p>${message ? `<p>${e(message).replace(/\n/g, "<br>")}</p>` : ""}<p><a href="${e(link)}">${e(link)}</a></p>`;
    try {
      await (deps.mailer ?? smtpMailer(s, config)).send({ to, subject, text, html: body });
      return null;
    } catch (err) {
      return (err as Error).message.slice(0, 300);
    }
  }
  const orgName = async (companyId: string) => (await db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId)))[0]?.name ?? (await getSettings(db)).organizationName ?? "";

  return new Hono<AppEnv>()
    .use("*", requireModule(db, "suppliers"))
    .get("/:id/questionnaires", requirePerm("suppliers:read"), async (c) => {
      const s = await supplierOf(c, c.req.param("id"));
      return c.json(await loadList(db, eq(supplierQuestionnaires.supplierId, s.id)));
    })
    .post("/:id/questionnaires", requirePerm("suppliers:write"), zValidator("json", QuestionnaireCreateInput), async (c) => {
      const s = await supplierOf(c, c.req.param("id"));
      const input = c.req.valid("json");
      const t = await tFor(db, c);
      const to = input.email || s.contactEmail || null;
      if (input.sendEmail && !to) throw new ApiError(400, "err.sq.noEmail");
      const { token, hash } = newToken();
      const expiresAt = new Date(Date.now() + input.validDays * 86_400_000);
      // výchozí název v jazyce dotazníku (vidí ho dodavatel)
      const title = input.title || (await translatorFor(db, input.locale))("srv.sq.defaultTitle", { year: String(new Date().getFullYear()) });
      const [r] = await db
        .insert(supplierQuestionnaires)
        .values({ companyId: s.companyId, supplierId: s.id, title, template: input.template, locale: input.locale, tokenHash: hash, expiresAt, sentTo: input.sendEmail ? to : null, message: input.message ?? null, createdById: currentUser(c).id })
        .returning();
      const link = questionnaireLink(config, token);
      let emailError: string | null = null;
      if (input.sendEmail) {
        emailError = await sendLink(to!, link, input.locale, await orgName(s.companyId), s.name, expiresAt, input.message ?? null);
        if (emailError === "smtp") emailError = t("srv.sq.smtpMissing");
        if (emailError) await db.update(supplierQuestionnaires).set({ sentTo: null }).where(eq(supplierQuestionnaires.id, r!.id));
      }
      await audit(db, { c, user: currentUser(c), action: "supplier.questionnaire_sent", entityType: "supplier", entityId: s.id, details: { questionnaireId: r!.id, template: input.template, emailed: input.sendEmail && !emailError } });
      return c.json({ questionnaire: await one(r!.id), link, emailed: input.sendEmail && !emailError, emailError }, 201);
    })
    /** Nový odkaz (starý přestane platit); u neodevzdaného dotazníku prodlouží platnost. */
    .post("/:id/questionnaires/:qid/link", requirePerm("suppliers:write"), zValidator("json", QuestionnaireCreateInput.pick({ validDays: true })), async (c) => {
      const { s, r } = await rowOf(c, c.req.param("id"), c.req.param("qid"));
      if (r.status !== "sent") throw new ApiError(409, "err.sq.notOpen");
      const { token, hash } = newToken();
      const expiresAt = new Date(Date.now() + c.req.valid("json").validDays * 86_400_000);
      await db.update(supplierQuestionnaires).set({ tokenHash: hash, expiresAt }).where(eq(supplierQuestionnaires.id, r.id));
      await audit(db, { c, user: currentUser(c), action: "supplier.questionnaire_link", entityType: "supplier", entityId: s.id, details: { questionnaireId: r.id } });
      return c.json({ questionnaire: await one(r.id), link: questionnaireLink(config, token) });
    })
    .post("/:id/questionnaires/:qid/cancel", requirePerm("suppliers:write"), async (c) => {
      const { s, r } = await rowOf(c, c.req.param("id"), c.req.param("qid"));
      if (r.status !== "sent") throw new ApiError(409, "err.sq.notOpen");
      await db.update(supplierQuestionnaires).set({ status: "cancelled" }).where(eq(supplierQuestionnaires.id, r.id));
      await audit(db, { c, user: currentUser(c), action: "supplier.questionnaire_cancelled", entityType: "supplier", entityId: s.id, details: { questionnaireId: r.id } });
      return c.json(await one(r.id));
    })
    /** Vrátit dodavateli k doplnění (odevzdaný, dosud nevyhodnocený). */
    .post("/:id/questionnaires/:qid/reopen", requirePerm("suppliers:write"), async (c) => {
      const { s, r } = await rowOf(c, c.req.param("id"), c.req.param("qid"));
      if (r.status !== "submitted") throw new ApiError(409, "err.sq.notSubmitted");
      const expiresAt = r.expiresAt < new Date() ? new Date(Date.now() + 14 * 86_400_000) : r.expiresAt;
      await db.update(supplierQuestionnaires).set({ status: "sent", submittedAt: null, expiresAt }).where(eq(supplierQuestionnaires.id, r.id));
      await audit(db, { c, user: currentUser(c), action: "supplier.questionnaire_reopened", entityType: "supplier", entityId: s.id, details: { questionnaireId: r.id } });
      return c.json(await one(r.id));
    })
    .post("/:id/questionnaires/:qid/evaluate", requirePerm("suppliers:write"), zValidator("json", QuestionnaireEvaluateInput), async (c) => {
      const { s, r } = await rowOf(c, c.req.param("id"), c.req.param("qid"));
      if (r.status !== "submitted") throw new ApiError(409, "err.sq.notSubmitted");
      const input = c.req.valid("json");
      const now = new Date();
      await db.update(supplierQuestionnaires).set({ status: "evaluated", evaluatedAt: now, evaluatedById: currentUser(c).id, evaluationNote: input.note ?? null }).where(eq(supplierQuestionnaires.id, r.id));
      if (input.markRiskAssessed) await db.update(suppliers).set({ riskAssessedAt: now.toISOString().slice(0, 10) }).where(eq(suppliers.id, s.id));
      const q = await one(r.id);
      await audit(db, { c, user: currentUser(c), action: "supplier.questionnaire_evaluated", entityType: "supplier", entityId: s.id, details: { questionnaireId: r.id, score: q.result.score, level: q.result.level } });
      return c.json(q);
    })
    /** Založí riziko dodavatele z mezer dotazníku (na pokyn uživatele; hodnocení rizika doplní vlastník). */
    .post("/:id/questionnaires/:qid/risk", requirePerm("suppliers:write"), async (c) => {
      if (!hasPerm(c, "risks:write")) throw new ApiError(403, "err.sq.riskPerm");
      if (!(await getSettings(db)).enabledModules.includes("risks")) throw new ApiError(409, "err.sq.risksOff");
      const { s, r } = await rowOf(c, c.req.param("id"), c.req.param("qid"));
      if (r.status !== "submitted" && r.status !== "evaluated") throw new ApiError(409, "err.sq.notSubmitted");
      if (r.riskId) throw new ApiError(409, "err.sq.riskExists");
      const t = await tFor(db, c);
      const q = await one(r.id);
      const res = q.result;
      const gaps = res.gaps.map((g) => `- ${qText(t, g.key)} – ${t.lbl(QUESTIONNAIRE_LABELS.answer[g.value])}${g.critical ? ` (${t("srv.sq.critical")})` : ""}${g.comment ? `: ${g.comment}` : ""}`);
      const description = [
        t("srv.sq.riskIntro", { title: q.title, date: q.submittedAt?.slice(0, 10) ?? "", score: res.score == null ? "—" : String(res.score), level: res.level ? t.lbl(QUESTIONNAIRE_LABELS.level[res.level]) : "—" }),
        gaps.length ? `\n${t("srv.sq.riskGaps")}\n${gaps.join("\n")}` : `\n${t("srv.sq.riskNoGaps")}`,
      ].join("\n");
      const [threat] = await db.select({ id: riskCatalog.id }).from(riskCatalog).where(and(eq(riskCatalog.kind, "threat"), eq(riskCatalog.code, "H11"), eq(riskCatalog.isActive, true))).limit(1);
      const policy = (await settingsFor(db, c, s.companyId)).riskPolicy;
      const [risk] = await db
        .insert(risks)
        .values({
          companyId: s.companyId,
          name: t("srv.sq.riskName", { supplier: s.name }).slice(0, 500),
          description: description.slice(0, 10000),
          threatId: threat?.id ?? null,
          status: "identified",
          scaleLevels: policy.levels,
          methodologyKey: policy.methodology || BUILTIN_RISK_METHODOLOGY,
        })
        .returning({ id: risks.id, name: risks.name });
      await db.insert(supplierRisks).values({ supplierId: s.id, riskId: risk!.id }).onConflictDoNothing();
      await db.update(supplierQuestionnaires).set({ riskId: risk!.id }).where(eq(supplierQuestionnaires.id, r.id));
      await audit(db, { c, user: currentUser(c), action: "risk.created", entityType: "risk", entityId: risk!.id, details: { name: risk!.name, source: "supplier_questionnaire", questionnaireId: r.id } });
      return c.json({ riskId: risk!.id }, 201);
    })
    .delete("/:id/questionnaires/:qid", requirePerm("suppliers:write"), async (c) => {
      const { s, r } = await rowOf(c, c.req.param("id"), c.req.param("qid"));
      if (r.status === "evaluated") throw new ApiError(409, "err.sq.evaluatedKeep");
      await db.delete(supplierQuestionnaires).where(eq(supplierQuestionnaires.id, r.id));
      await audit(db, { c, user: currentUser(c), action: "supplier.questionnaire_deleted", entityType: "supplier", entityId: s.id, details: { questionnaireId: r.id } });
      return c.body(null, 204);
    })
    .get("/:id/questionnaires/:qid/files/:fileId", requirePerm("suppliers:read"), async (c) => {
      const { s, r } = await rowOf(c, c.req.param("id"), c.req.param("qid"));
      const [f] = await db.select().from(supplierQuestionnaireFiles).where(and(eq(supplierQuestionnaireFiles.id, c.req.param("fileId")), eq(supplierQuestionnaireFiles.questionnaireId, r.id)));
      if (!f) throw new ApiError(404, "err.sq.fileNotFound");
      await audit(db, { c, user: currentUser(c), action: "supplier.questionnaire_file_downloaded", entityType: "supplier", entityId: s.id, details: { questionnaireId: r.id, file: f.filename, sha256: f.sha256 } });
      // vždy jako příloha, typ podle přípony, bez odhadování typu prohlížečem
      return c.body(new Uint8Array(f.content), 200, {
        "content-type": f.mime,
        "content-disposition": `attachment; filename="${f.filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      });
    })
    .get("/:id/questionnaires/:qid/report.html", requirePerm("suppliers:read"), async (c) => {
      const { s, r } = await rowOf(c, c.req.param("id"), c.req.param("qid"));
      return c.html(questionnaireReportHtml(await one(r.id), s.name, await tFor(db, c)));
    });
}

/* ---------- veřejné API pro dodavatele (bez přihlášení, token v cestě) ---------- */

function publicStatus(r: Row): PublicQuestionnaireDto["status"] {
  if (r.status === "submitted" || r.status === "evaluated") return "submitted";
  if (r.status === "cancelled" || r.expiresAt < new Date()) return "closed";
  return "open";
}

export function publicQuestionnaireRoutes(db: Db) {
  async function byToken(token: string) {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new ApiError(404, "err.sq.linkInvalid");
    const [r] = await db.select().from(supplierQuestionnaires).where(eq(supplierQuestionnaires.tokenHash, hashToken(token)));
    if (!r) throw new ApiError(404, "err.sq.linkInvalid");
    return r;
  }
  async function view(r: Row): Promise<PublicQuestionnaireDto> {
    const [s] = await db.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, r.supplierId));
    const [co] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, r.companyId));
    const locale = (r.locale === "en" ? "en" : "cs") as QuestionnaireLocale;
    const template = (r.template === "cz410" ? "cz410" : "cz409") as QuestionnaireTemplate;
    const status = publicStatus(r);
    const qs = questionsFor(template);
    return {
      title: r.title,
      organization: co?.name ?? (await getSettings(db)).organizationName ?? "",
      supplierName: s?.name ?? "",
      template,
      locale,
      status,
      expiresAt: r.expiresAt.toISOString(),
      message: r.message,
      sections: QUESTIONNAIRE_SECTIONS.filter((x) => qs.some((q) => q.section === x.key)).map((x) => ({ key: x.key, title: x.title[locale] })),
      questions: qs.map((q) => ({ key: q.key, section: q.section, text: q.text[locale], critical: !!q.critical, allowNa: !!q.allowNa })),
      // po uzavření bez odevzdání se rozpracované odpovědi už nezobrazují
      answers: status === "closed" ? {} : r.answers,
      respondentName: status === "closed" ? null : r.respondentName,
      respondentEmail: status === "closed" ? null : r.respondentEmail,
      respondentRole: status === "closed" ? null : r.respondentRole,
      generalNote: status === "closed" ? null : r.generalNote,
      submittedAt: r.submittedAt?.toISOString() ?? null,
      files: status === "closed" ? [] : ((await filesOf(db, [r.id])).get(r.id) ?? []),
    };
  }
  /** Odpovědi jen na otázky šablony; „netýká se“ jen tam, kde je dovoleno. */
  function clean(template: QuestionnaireTemplate, answers: QuestionnaireSaveInput["answers"]) {
    const qs = new Map(questionsFor(template).map((q) => [q.key, q]));
    return Object.fromEntries(
      Object.entries(answers)
        .filter(([k, a]) => qs.has(k) && (a.value !== "na" || qs.get(k)!.allowNa))
        .map(([k, a]) => [k, { value: a.value, comment: a.comment || null, evidence: a.evidence || null }]),
    );
  }

  return new Hono<AppEnv>()
    .get("/:token", async (c) => c.json(await view(await byToken(c.req.param("token")))))
    .put("/:token", zValidator("json", QuestionnaireSaveInput), async (c) => {
      const r = await byToken(c.req.param("token"));
      if (publicStatus(r) !== "open") throw new ApiError(409, "err.sq.closed");
      const input = c.req.valid("json");
      const template = (r.template === "cz410" ? "cz410" : "cz409") as QuestionnaireTemplate;
      await db
        .update(supplierQuestionnaires)
        .set({ answers: clean(template, input.answers), respondentName: input.respondentName ?? null, respondentEmail: input.respondentEmail ?? null, respondentRole: input.respondentRole ?? null, generalNote: input.generalNote ?? null, lastSavedAt: new Date() })
        .where(eq(supplierQuestionnaires.id, r.id));
      return c.json(await view((await db.select().from(supplierQuestionnaires).where(eq(supplierQuestionnaires.id, r.id)))[0]!));
    })
    /** Příloha dodavatele (multipart: file, questionKey) – jen u otevřeného dotazníku, limity velikosti a počtu, typ podle přípony. */
    .post("/:token/files", async (c) => {
      const r = await byToken(c.req.param("token"));
      if (publicStatus(r) !== "open") throw new ApiError(409, "err.sq.closed");
      const len = Number(c.req.header("content-length") ?? 0);
      if (len > QUESTIONNAIRE_FILE_MAX_BYTES + 64 * 1024) throw new ApiError(413, "err.sq.fileTooLarge");
      const body = await c.req.parseBody();
      const file = body.file;
      if (!(file instanceof File) || file.size === 0) throw new ApiError(400, "err.sq.fileMissing");
      if (file.size > QUESTIONNAIRE_FILE_MAX_BYTES) throw new ApiError(413, "err.sq.fileTooLarge");
      const filename = safeFilename(file.name);
      if (!questionnaireFileAllowed(filename)) throw new ApiError(400, "err.sq.fileType");
      const template = (r.template === "cz410" ? "cz410" : "cz409") as QuestionnaireTemplate;
      const qk = typeof body.questionKey === "string" && body.questionKey ? body.questionKey : null;
      if (qk && !questionsFor(template).some((x) => x.key === qk)) throw new ApiError(400, "err.sq.fileQuestion");
      const [agg] = await db
        .select({ n: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${supplierQuestionnaireFiles.size}), 0)::bigint` })
        .from(supplierQuestionnaireFiles)
        .where(eq(supplierQuestionnaireFiles.questionnaireId, r.id));
      if ((agg?.n ?? 0) >= QUESTIONNAIRE_FILES_MAX) throw new ApiError(409, "err.sq.fileCount", { n: String(QUESTIONNAIRE_FILES_MAX) });
      if (Number(agg?.total ?? 0) + file.size > QUESTIONNAIRE_FILES_TOTAL_MAX) throw new ApiError(413, "err.sq.fileTotal");
      const buf = Buffer.from(await file.arrayBuffer());
      const sha256 = createHash("sha256").update(buf).digest("hex");
      await db.insert(supplierQuestionnaireFiles).values({ questionnaireId: r.id, questionKey: qk, filename, mime: mimeFor(filename), size: buf.length, sha256, content: buf });
      await db.update(supplierQuestionnaires).set({ lastSavedAt: new Date() }).where(eq(supplierQuestionnaires.id, r.id));
      await audit(db, { c, user: null, action: "supplier.questionnaire_file_uploaded", entityType: "supplier", entityId: r.supplierId, details: { questionnaireId: r.id, file: filename, size: buf.length, sha256 } });
      return c.json(await view((await db.select().from(supplierQuestionnaires).where(eq(supplierQuestionnaires.id, r.id)))[0]!), 201);
    })
    .delete("/:token/files/:fileId", async (c) => {
      const r = await byToken(c.req.param("token"));
      if (publicStatus(r) !== "open") throw new ApiError(409, "err.sq.closed");
      const del = await db
        .delete(supplierQuestionnaireFiles)
        .where(and(eq(supplierQuestionnaireFiles.id, c.req.param("fileId")), eq(supplierQuestionnaireFiles.questionnaireId, r.id)))
        .returning({ filename: supplierQuestionnaireFiles.filename });
      if (!del.length) throw new ApiError(404, "err.sq.fileNotFound");
      await audit(db, { c, user: null, action: "supplier.questionnaire_file_removed", entityType: "supplier", entityId: r.supplierId, details: { questionnaireId: r.id, file: del[0]!.filename } });
      return c.json(await view(r));
    })
    .post("/:token/submit", zValidator("json", QuestionnaireSubmitInput), async (c) => {
      const r = await byToken(c.req.param("token"));
      if (publicStatus(r) !== "open") throw new ApiError(409, "err.sq.closed");
      const input = c.req.valid("json");
      const template = (r.template === "cz410" ? "cz410" : "cz409") as QuestionnaireTemplate;
      const answers = clean(template, input.answers);
      const res = scoreQuestionnaire(template, answers);
      if (res.missing.length) throw new ApiError(400, "err.sq.incomplete", { n: String(res.missing.length) });
      const now = new Date();
      // podmínka na stav – souběžné odevzdání proběhne jen jednou
      const done = await db
        .update(supplierQuestionnaires)
        .set({ answers, respondentName: input.respondentName, respondentEmail: input.respondentEmail, respondentRole: input.respondentRole ?? null, generalNote: input.generalNote ?? null, lastSavedAt: now, submittedAt: now, status: "submitted" })
        .where(and(eq(supplierQuestionnaires.id, r.id), inArray(supplierQuestionnaires.status, ["sent"])))
        .returning({ id: supplierQuestionnaires.id });
      if (!done.length) throw new ApiError(409, "err.sq.closed");
      await audit(db, { c, user: null, action: "supplier.questionnaire_submitted", entityType: "supplier", entityId: r.supplierId, details: { questionnaireId: r.id, score: res.score, respondent: input.respondentEmail } });
      return c.json(await view((await db.select().from(supplierQuestionnaires).where(eq(supplierQuestionnaires.id, r.id)))[0]!));
    });
}
