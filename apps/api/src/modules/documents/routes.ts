import { riskDataReport } from "../risks/scenarios";
import { appetiteDto } from "../risks/appetite";
import { profileOf, ApproveDocumentInput,
  CreateDocumentInput,
  DOC_KINDS,
  DOC_RETENTION_YEARS,
  docTitle,
  FrameworkIdSchema,
  type DocKind,
  type DocumentVersionDto,
  type FrameworkId,
  type ModuleKey,
  type Permission,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, inArray, max, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, hasPerm } from "../../auth/middleware";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import { assertScope, settingsFor, soleCompany } from "../../auth/scope";
import type { Db } from "../../db/client";
import { changes, documentAcknowledgements, documentVersions, users } from "../../db/schema";
import { loadChanges, periodWhere } from "../isms/routes";
import { infoItemsForReport } from "../infoservice/routes";
import { incidentSummary } from "../incidents/routes";
import { auditSummary } from "../audits/routes";
import { htmlToDocx, docxResponse } from "./docx";
import { renderDocument, type RenderInfo } from "./render";
import { LOCALE_RE, type Translate } from "@contix/shared";
import { tFor, translatorFor } from "../i18n/service";

/** Dokumenty se širokými tabulkami – na šířku. */
const LANDSCAPE = new Set<string>(["soa", "risk_report", "treatment_plan"]);
import { ismsReviewSnapshot, metaOf, metricsOf, planSnapshot, riskReportSnapshot, soaSnapshot, type Snapshot } from "./snapshots";
import { ApiError } from "../../lib/apiError";

type Ctx = Context<AppEnv>;

/** Který modul a oprávnění dokument vyžaduje. */
const KIND_RULES: Record<DocKind, { module: ModuleKey; read: Permission; write: Permission }> = {
  risk_report: { module: "risks", read: "risks:read", write: "risks:write" },
  treatment_plan: { module: "risks", read: "risks:read", write: "risks:write" },
  soa: { module: "controls", read: "controls:read", write: "controls:write" },
  isms_review: { module: "isms", read: "isms:read", write: "isms:write" },
};

export function documentRoutes(db: Db) {
  async function guard(c: Ctx, kind: DocKind, need: "read" | "write") {
    const rule = KIND_RULES[kind];
    const s = await getSettings(db);
    if (!s.enabledModules.includes(rule.module)) throw new HTTPException(404, { message: "Modul je vypnutý" });
    if (!hasPerm(c, rule[need])) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
  }

  async function buildSnapshot(
    companyId: string,
    kind: DocKind,
    framework: FrameworkId | null,
    input?: { inputs?: Record<string, string>; periodFrom?: string | null; periodTo?: string | null },
  ): Promise<Snapshot> {
    const s = await settingsFor(db, null, companyId);
    const meta = metaOf(s, input);
    if (kind === "soa") {
      if (!framework) throw new HTTPException(400, { message: "U prohlášení o aplikovatelnosti vyberte rámec" });
      return soaSnapshot(db, meta, companyId, framework);
    }
    if (kind === "risk_report") {
      const snap = await riskReportSnapshot(db, meta, s.riskPolicy, input?.inputs ?? {}, companyId);
      if (s.enabledModules.includes("isms")) {
        const list = await loadChanges(db, and(eq(changes.companyId, companyId), eq(changes.significant, true), periodWhere(meta.periodFrom, meta.periodTo)));
        snap.significantChanges = list.map((c) => ({ code: c.code, title: c.title, status: c.status, day: c.implementedAt ?? c.plannedAt }));
      }
      if (s.enabledModules.includes("legislation")) snap.infoItems = await infoItemsForReport(db, companyId, meta.periodFrom, meta.periodTo);
      if (s.enabledModules.includes("incidents")) {
        const inc = await incidentSummary(db, meta.periodFrom, meta.periodTo, [companyId]);
        snap.incidents = inc.list.map((x) => ({ code: x.code, title: x.title, category: x.category, detectedAt: x.detectedAt, significant: x.significant }));
      }
      if (s.enabledModules.includes("audits")) {
        const a = await auditSummary(db, profileOf(s).defaultFramework, meta.periodFrom, meta.periodTo, [companyId]);
        snap.audits = { audits: a.audits.map((x) => ({ code: x.code, title: x.title, performedEnd: x.performedEnd, findings: x.findings })), openFindings: a.openFindings, overdueFindings: a.overdueFindings };
      }
      // analýza rizik z dat (v1.19, ADR-116) – jen když ji společnost používá (primární aktiva / scénáře)
      const dd = await riskDataReport(db, companyId, { from: meta.periodFrom, to: meta.periodTo });
      if (dd) snap.dataDriven = dd;
      const ap = await appetiteDto(db, companyId);
      if (ap.categories.some((x) => x.maxLevel) || ap.kris.some((k) => k.status !== "unknown")) snap.appetite = ap;
      return snap;
    }
    if (kind === "isms_review") {
      const snap = await ismsReviewSnapshot(db, meta, s, input?.inputs ?? {}, companyId);
      if (s.enabledModules.includes("risks")) {
        const ap = await appetiteDto(db, companyId);
        if (ap.categories.some((x) => x.maxLevel) || ap.kris.some((k) => k.status !== "unknown")) snap.appetite = ap;
      }
      return snap;
    }
    return planSnapshot(db, meta, s.riskPolicy, companyId);
  }

  async function toDto(c: Ctx, rows: (typeof documentVersions.$inferSelect)[]): Promise<DocumentVersionDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const userIds = [...new Set(rows.flatMap((r) => [r.createdById, r.approvedById]).filter((x): x is string => !!x))];
    const [acks, names] = await Promise.all([
      db
        .select({ versionId: documentAcknowledgements.versionId, userId: documentAcknowledgements.userId, at: documentAcknowledgements.at, name: users.displayName })
        .from(documentAcknowledgements)
        .innerJoin(users, eq(users.id, documentAcknowledgements.userId))
        .where(inArray(documentAcknowledgements.versionId, ids))
        .orderBy(documentAcknowledgements.at),
      userIds.length ? db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, userIds)) : [],
    ]);
    const nameOf = new Map(names.map((n) => [n.id, n.name]));
    const me = currentUser(c).id;
    return rows.map((r) => {
      const a = acks.filter((x) => x.versionId === r.id);
      let retainUntil: string | null = null;
      if (r.approvedAt) {
        const d = new Date(r.approvedAt);
        d.setFullYear(d.getFullYear() + DOC_RETENTION_YEARS);
        retainUntil = d.toISOString().slice(0, 10);
      }
      return {
        id: r.id,
        kind: r.kind,
        framework: r.framework || null,
        version: r.version,
        title: r.title,
        status: r.status,
        note: r.note,
        metrics: r.metrics,
        createdByName: r.createdById ? (nameOf.get(r.createdById) ?? null) : null,
        createdAt: r.createdAt.toISOString(),
        approvedByName: r.approvedById ? (nameOf.get(r.approvedById) ?? null) : null,
        approvedAt: r.approvedAt?.toISOString() ?? null,
        approvalNote: r.approvalNote,
        retainUntil,
        acknowledgements: a.map((x) => ({ userId: x.userId, userName: x.name, at: x.at.toISOString() })),
        acknowledgedByMe: a.some((x) => x.userId === me),
        canApprove: r.status === "draft" && hasPerm(c, "documents:approve"),
        canDelete: r.status === "draft" && hasPerm(c, KIND_RULES[r.kind].write),
      };
    });
  }

  async function load(c: Ctx, id: string) {
    const [row] = await db.select().from(documentVersions).where(eq(documentVersions.id, id));
    if (!row) throw new HTTPException(404, { message: "Dokument nenalezen" });
    assertScope(c, row.companyId, "Dokument nenalezen");
    return row;
  }

  function html(c: Ctx, body: string) {
    return c.body(body, 200, {
      "content-type": "text/html; charset=utf-8",
      // tiskový dokument: jen inline styl a tlačítko Tisk, žádné externí zdroje
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:",
    });
  }

  const KindQuery = z.object({ kind: z.enum(DOC_KINDS), framework: FrameworkIdSchema.optional(), companyId: z.string().uuid().optional(), lang: z.string().regex(LOCALE_RE).optional() });
  /** Jazyk výstupu: ?lang= (volba při exportu), jinak jazyk uživatele (ADR-036). */
  const outT = async (c: Parameters<typeof tFor>[1]): Promise<Translate> => {
    const l = c.req.query("lang");
    return l && LOCALE_RE.test(l) ? translatorFor(db, l) : tFor(db, c);
  };
  /** Název v jazyce výstupu – výchozí (český) název SoA se přeloží, vlastní název zůstává. */
  const titleIn = (t: Translate, kind: DocKind, fw: string | null, stored?: string) => {
    const def = docTitle(kind, fw);
    if (kind !== "soa" || (stored && stored !== def)) return stored ?? def;
    return fw === "cz410" ? t("doc.title.soa410") : t("doc.title.soa");
  };

  return (
    new Hono<AppEnv>()
      .get("/", zValidator("query", KindQuery), async (c) => {
        const { kind, framework, companyId: requested } = c.req.valid("query");
        await guard(c, kind, "read");
        const companyId = soleCompany(c, requested);
        const rows = await db
          .select()
          .from(documentVersions)
          .where(and(eq(documentVersions.companyId, companyId), eq(documentVersions.kind, kind), eq(documentVersions.framework, framework ?? "")))
          .orderBy(desc(documentVersions.version));
        return c.json(await toDto(c, rows));
      })
      /** Náhled aktuálního stavu (neukládá se). */
      .get("/preview.html", zValidator("query", KindQuery), async (c) => {
        const { kind, framework, companyId: requested } = c.req.valid("query");
        await guard(c, kind, "read");
        const snap = await buildSnapshot(soleCompany(c, requested), kind, framework ?? null);
        const t = await outT(c);
        const info: RenderInfo = {
          t,
          kind,
          framework: framework ?? null,
          version: null,
          status: "preview",
          title: titleIn(t, kind, framework ?? null),
          note: null,
          createdByName: null,
          createdAt: null,
          approvedByName: null,
          approvedAt: null,
          approvalNote: null,
          acknowledgements: [],
        };
        return html(c, renderDocument(snap, info));
      })
      /** Náhled aktuálního stavu jako Word. */
      .get("/preview.docx", zValidator("query", KindQuery), async (c) => {
        const { kind, framework, companyId: requested } = c.req.valid("query");
        await guard(c, kind, "read");
        const snap = await buildSnapshot(soleCompany(c, requested), kind, framework ?? null);
        const t = await outT(c);
        const title = (t.locale === "cs" ? snap.meta.basis?.titles[kind] : undefined) ?? titleIn(t, kind, framework ?? null);
        const info: RenderInfo = { t, kind, framework: framework ?? null, version: null, status: "preview", title, note: null, createdByName: null, createdAt: null, approvedByName: null, approvedAt: null, approvalNote: null, acknowledgements: [] };
        const buf = await htmlToDocx(renderDocument(snap, info), { title: `${title} – ${t("doc.previewSuffix")}`, headerLine: (snap as { meta: { organizationName: string } }).meta.organizationName, landscape: LANDSCAPE.has(kind) });
        return docxResponse(buf, `${title} (${t("doc.previewSuffix")}).docx`);
      })
      .post("/", zValidator("json", CreateDocumentInput), async (c) => {
        const input = c.req.valid("json");
        await guard(c, input.kind, "write");
        const fw = input.kind === "soa" ? (input.framework ?? null) : null;
        const companyId = soleCompany(c, input.companyId);
        const snap = await buildSnapshot(companyId, input.kind, fw, input);
        const created = await db.transaction(async (tx) => {
          // serializace čísel verzí téhož dokumentu
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`doc:${companyId}:${input.kind}:${fw ?? ""}`}))`);
          const [m] = await tx
            .select({ v: max(documentVersions.version) })
            .from(documentVersions)
            .where(and(eq(documentVersions.companyId, companyId), eq(documentVersions.kind, input.kind), eq(documentVersions.framework, fw ?? "")));
          const [row] = await tx
            .insert(documentVersions)
            .values({
              companyId,
              kind: input.kind,
              framework: fw ?? "",
              version: (m?.v ?? 0) + 1,
              // název podle rámce společnosti (ADR-086), např. „Přezkum rámce řízení rizik IKT“ u DORA
              title: input.title || snap.meta.basis?.titles[input.kind] || docTitle(input.kind, fw),
              note: input.note ?? null,
              snapshot: snap,
              metrics: metricsOf(snap),
              createdById: currentUser(c).id,
            })
            .returning();
          return row!;
        });
        await audit(db, { c, user: currentUser(c), action: "document.created", entityType: "document", entityId: created.id, details: { kind: input.kind, framework: fw, version: created.version } });
        return c.json((await toDto(c, [created]))[0], 201);
      })
      .get("/:id", async (c) => {
        const row = await load(c, c.req.param("id"));
        await guard(c, row.kind, "read");
        return c.json((await toDto(c, [row]))[0]);
      })
      .get("/:id/html", async (c) => {
        const row = await load(c, c.req.param("id"));
        await guard(c, row.kind, "read");
        const [dto] = await toDto(c, [row]);
        const t = await outT(c);
        const info: RenderInfo = {
          t,
          kind: row.kind,
          framework: row.framework || null,
          version: row.version,
          status: row.status,
          title: titleIn(t, row.kind, row.framework || null, row.title),
          note: row.note,
          createdByName: dto!.createdByName,
          createdAt: dto!.createdAt,
          approvedByName: dto!.approvedByName,
          approvedAt: dto!.approvedAt,
          approvalNote: row.approvalNote,
          acknowledgements: dto!.acknowledgements,
        };
        return html(c, renderDocument(row.snapshot as Snapshot, info));
      })
      .get("/:id/docx", async (c) => {
        const row = await load(c, c.req.param("id"));
        await guard(c, row.kind, "read");
        const [dto] = await toDto(c, [row]);
        const t = await outT(c);
        const info: RenderInfo = {
          t,
          kind: row.kind,
          framework: row.framework || null,
          version: row.version,
          status: row.status,
          title: titleIn(t, row.kind, row.framework || null, row.title),
          note: row.note,
          createdByName: dto!.createdByName,
          createdAt: dto!.createdAt,
          approvedByName: dto!.approvedByName,
          approvedAt: dto!.approvedAt,
          approvalNote: row.approvalNote,
          acknowledgements: dto!.acknowledgements,
        };
        const snap = row.snapshot as Snapshot;
        const buf = await htmlToDocx(renderDocument(snap, info), { title: `${info.title} v${row.version}`, headerLine: (snap as { meta: { organizationName: string } }).meta.organizationName, landscape: LANDSCAPE.has(row.kind) });
        await audit(db, { c, user: currentUser(c), action: "document.exported", entityType: "document", entityId: row.id, details: { format: "docx", version: row.version } });
        return docxResponse(buf, `${info.title} v${row.version}.docx`);
      })
      .post("/:id/approve", zValidator("json", ApproveDocumentInput), async (c) => {
        if (!hasPerm(c, "documents:approve")) throw new HTTPException(403, { message: "Schvalovat dokumenty může jen oprávněná osoba" });
        const row = await load(c, c.req.param("id"));
        await guard(c, row.kind, "read");
        if (row.status !== "draft") throw new HTTPException(409, { message: "Schválit lze jen návrh" });
        const { note } = c.req.valid("json");
        await db.transaction(async (tx) => {
          await tx
            .update(documentVersions)
            .set({ status: "superseded", updatedAt: new Date() })
            .where(and(eq(documentVersions.companyId, row.companyId), eq(documentVersions.kind, row.kind), eq(documentVersions.framework, row.framework), eq(documentVersions.status, "approved")));
          await tx
            .update(documentVersions)
            .set({ status: "approved", approvedById: currentUser(c).id, approvedAt: new Date(), approvalNote: note ?? null, updatedAt: new Date() })
            .where(eq(documentVersions.id, row.id));
        });
        await audit(db, { c, user: currentUser(c), action: "document.approved", entityType: "document", entityId: row.id, details: { kind: row.kind, version: row.version } });
        return c.json((await toDto(c, [await load(c, row.id)]))[0]);
      })
      /** Prokazatelné seznámení (§ 4 odst. 2 vyhl. 409/2025). */
      .post("/:id/acknowledge", async (c) => {
        const row = await load(c, c.req.param("id"));
        await guard(c, row.kind, "read");
        if (row.status === "draft") throw new HTTPException(409, { message: "Seznámit se lze se schválenou verzí" });
        await db.insert(documentAcknowledgements).values({ versionId: row.id, userId: currentUser(c).id }).onConflictDoNothing();
        await audit(db, { c, user: currentUser(c), action: "document.acknowledged", entityType: "document", entityId: row.id, details: { kind: row.kind, version: row.version } });
        return c.json((await toDto(c, [row]))[0]);
      })
      .delete("/:id", async (c) => {
        const row = await load(c, c.req.param("id"));
        await guard(c, row.kind, "write");
        if (row.status !== "draft") throw new ApiError(409, "err.documents.approvedRetained", { years: String(DOC_RETENTION_YEARS) });
        await db.delete(documentVersions).where(eq(documentVersions.id, row.id));
        await audit(db, { c, user: currentUser(c), action: "document.deleted", entityType: "document", entityId: row.id, details: { kind: row.kind, version: row.version } });
        return c.body(null, 204);
      })
  );
}
