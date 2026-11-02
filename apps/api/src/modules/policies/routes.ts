import { withLegalRefs, czDecreeOf, profileOf, ancestorsOf,
  CheckinInput,
  DisposeInput,
  DOC_CODE_PREFIX,
  folderTree,
  FromTemplateInput,
  nextDocCode,
  nextReview,
  POLICY_LABELS,
  TEMPLATE_PLACEHOLDERS,
  type PolicyEventAction,
  type PdfStatus,
  type PolicySearchHit,
  type VersionDiffDto,
  DocQaInput,
  snippetAround,
  officeAppOf,
  officeUri,
  OfficeOpenInput,
  type OfficeOpenDto,
  type RetentionMark,
  type DisposalMode,
  PolicyCommentInput,
  PolicyCommentResolveInput,
  PolicyInput,
  PolicyPatch,
  PolicyReviewInput,
  policyGaps,
  PolicyVersionInput,
  PolicyWorkflowInput,
  QuizAnswersInput,
  QuizInput,
  requirementsOf,
  requirementById,
  parentCycle,
  frameworkExists,
  type FrameworkId,
  DocImportOptions,
  POLICY_LABELS as LABELS_ALL,
  type DocImportResultDto,
  POLICY_LINK_KINDS,
  type PolicyLinkKind,
  type PolicyRef,
  type MyPolicyItem,
  type Permission,
  type PolicyCommentDto,
  type PolicyCoverageRow,
  type PolicyDetail,
  type PolicyEventDto,
  type PolicyFileDto,
  type PolicyListItem,
  type PolicyVersionDto,
  type PolicyVersionStatus,
  type PortalDocDetail,
  type PortalDocItem,
  type QuizQuestionDto,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { createHash } from "node:crypto";
import { strToU8, zipSync, type Zippable } from "fflate";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, hasPerm, requireModule, requirePerm } from "../../auth/middleware";
import { profilesByCompany, assertScope, getCompanies, hasPermIn, inScope, scopeOf, settingsFor, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { tFor } from "../i18n/service";
import {
  controls,
  policies,
  policyAcknowledgements,
  policyComments,
  policyControls,
  policyAssets,
  policyProcesses,
  policyRelated,
  policyRequirements,
  policyRisks,
  policySuppliers,
  assets,
  processes,
  risks,
  suppliers,
  policyEditSessions,
  policyEvents,
  policyFiles,
  policyFolders,
  policyTemplates,
  companies,
  policyQuizAttempts,
  policyQuizQuestions,
  policyVersions,
  orgUnits,
  positionHolders,
  positions,
  trainingCourses,
  trainingRecords,
  users,
} from "../../db/schema";
import { safeFilename } from "../assurance/routes";
import { audienceMembers, audienceResolver, type AudienceMember } from "../org/audience";
import { fillWordTemplate, isWordTemplate } from "./docxTemplate";
import { dmsRoutes, folderPaths, retentionFor } from "./dms";
import { converterEnabled, fileKind, normalizeSearch, processFile, processPendingFiles, stampPdf } from "./convert";
import { diffText } from "./diff";
import { mimeFor } from "./mime";
import { buildPreview, IMPORT_ZIP_MAX, readImportZip } from "./bulkImport";
import { askDocs, indexPolicy, indexStatus, processDocIndex } from "./qa";
import { getAiSettings } from "../ai/service";
import { closeOfficeSessions, createOfficeSession } from "./webdav";
import { config as globalConfig, type Config } from "../../config";
import { ApiError } from "../../lib/apiError";

/* ============================================================
 * Politiky a dokumentace jako DMS (ADR-023): verze se soubory, workflow
 * gestor → vlastník procesu → schvalovatel (funkční místa), portál pro zaměstnance,
 * připomínky, seznámení s testem porozumění a vazba na školení.
 * ============================================================ */

type Ctx = Context<AppEnv>;
type PolicyRow = typeof policies.$inferSelect;
type VersionRow = typeof policyVersions.$inferSelect;
const today = () => new Date().toISOString().slice(0, 10);
/** Zástupné znaky LIKE (% _ \\) v hledaném textu se berou doslova. */
const likeEsc = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
const FILE_MAX = 25 * 1024 * 1024;
const PUBLIC_CLASSES = new Set(["public", "internal"]);
const reviewer = alias(positions, "pol_reviewer");
const approver = alias(positions, "pol_approver");
const author = alias(users, "pol_author");
const locker = alias(users, "pol_locker");
const responder = alias(users, "pol_responder");

const addDays = (d: string, n: number) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/** Načte dokumenty s platnou verzí, verzí v oběhu, stavem přezkumu a seznámení. */
/** `withAck: false` = bez okruhů dotčených osob a seznámení (rychlejší – např. termíny přezkumu). */
export async function loadPolicies(db: Db, where?: SQL, opts: { withAck?: boolean } = {}) {
  const withAck = opts.withAck ?? true;
  const rows = await db
    .select({ p: policies, owner: positions.name, reviewerName: reviewer.name, approverName: approver.name })
    .from(policies)
    .leftJoin(positions, eq(positions.id, policies.ownerPositionId))
    .leftJoin(reviewer, eq(reviewer.id, policies.reviewerPositionId))
    .leftJoin(approver, eq(approver.id, policies.approverPositionId))
    .where(where)
    .orderBy(asc(policies.code), asc(policies.title));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.p.id);
  const profiles = await profilesByCompany(db);
  const [versions, fileCounts, openComments] = await Promise.all([
    db
      .select({ v: policyVersions, approver: users.displayName, lockedBy: locker.displayName })
      .from(policyVersions)
      .leftJoin(users, eq(users.id, policyVersions.approvedById))
      .leftJoin(locker, eq(locker.id, policyVersions.lockedById))
      .where(inArray(policyVersions.policyId, ids))
      .orderBy(desc(policyVersions.createdAt)),
    db
      .select({ versionId: policyFiles.versionId, n: sql<number>`count(*)::int` })
      .from(policyFiles)
      .innerJoin(policyVersions, eq(policyVersions.id, policyFiles.versionId))
      .where(and(inArray(policyVersions.policyId, ids), isNull(policyFiles.supersededAt)))
      .groupBy(policyFiles.versionId),
    db
      .select({ policyId: policyComments.policyId, n: sql<number>`count(*)::int` })
      .from(policyComments)
      .where(and(inArray(policyComments.policyId, ids), eq(policyComments.status, "open")))
      .groupBy(policyComments.policyId),
  ]);
  const files = new Map(fileCounts.map((f) => [f.versionId, Number(f.n)]));
  const paths = await folderPaths(db, rows.map((r) => r.p.companyId));
  // hromadně: verze podle dokumentu, okruhy dotčených osob v paměti, seznámení s platnými verzemi jedním dotazem
  const currentIds = versions.filter((x) => x.v.status === "approved").map((x) => x.v.id);
  const acks = new Map<string, Set<string>>();
  const ackCount = new Map<string, number>();
  const allIds = versions.map((x) => x.v.id);
  const [agg, counts] = await Promise.all([
    withAck && currentIds.length
      ? db
          .select({ v: policyAcknowledgements.versionId, u: sql<string[]>`array_agg(${policyAcknowledgements.userId})` })
          .from(policyAcknowledgements)
          .where(inArray(policyAcknowledgements.versionId, currentIds))
          .groupBy(policyAcknowledgements.versionId)
      : [],
    withAck && allIds.length
      ? db.select({ v: policyAcknowledgements.versionId, n: sql<number>`count(*)::int` }).from(policyAcknowledgements).where(inArray(policyAcknowledgements.versionId, allIds)).groupBy(policyAcknowledgements.versionId)
      : [],
  ]);
  for (const a of agg) acks.set(a.v, new Set(a.u));
  for (const a of counts) ackCount.set(a.v, Number(a.n));
  const resolve = withAck ? await audienceResolver(db) : () => [];
  type VersionWithAcks = (typeof versions)[number] & { acks: number };
  const byPolicy = new Map<string, VersionWithAcks[]>();
  for (const v of versions) byPolicy.set(v.v.policyId, [...(byPolicy.get(v.v.policyId) ?? []), { ...v, acks: ackCount.get(v.v.id) ?? 0 }]);
  const comments = new Map(openComments.map((f) => [f.policyId, Number(f.n)]));
  const t = today();
  const out = [];
  for (const { p, owner, reviewerName, approverName } of rows) {
    const vs = byPolicy.get(p.id) ?? [];
    const current = vs.find((x) => x.v.status === "approved") ?? null;
    const pending = vs.find((x) => x.v.status === "review" || x.v.status === "approval") ?? null;
    const lockedV = vs.find((x) => x.v.lockedById);
    const members = p.requireAcknowledgement && current ? resolve(p.companyId, p.audience) : [];
    const ackSet = current ? (acks.get(current.v.id) ?? new Set<string>()) : new Set<string>();
    const approvedAt = current?.v.approvedAt?.toISOString().slice(0, 10) ?? null;
    const due = p.status === "retired" ? null : nextReview(p.lastReviewedAt, approvedAt, p.reviewMonths);
    const ack = { done: members.filter((m) => ackSet.has(m.userId)).length, required: members.length };
    const item: PolicyListItem = {
      id: p.id,
      companyId: p.companyId,
      code: p.code,
      title: p.title,
      folderId: p.folderId,
      folderPath: p.folderId ? (paths.get(p.folderId) ?? null) : null,
      parentId: p.parentId,
      docType: p.docType,
      system: p.system,
      status: p.status,
      sections: p.sections,
      classification: p.classification,
      ownerPositionId: p.ownerPositionId,
      ownerPositionName: owner,
      reviewerPositionName: reviewerName,
      approverPositionName: approverName,
      currentVersion: current?.v.version ?? null,
      pendingVersion: pending ? { version: pending.v.version, status: pending.v.status } : null,
      openComments: comments.get(p.id) ?? 0,
      approvedAt,
      lastReviewedAt: p.lastReviewedAt,
      nextReviewDue: due,
      reviewOverdue: !!due && due < t,
      ack,
      gaps: [],
      retention: retentionFor(p),
      locked: lockedV ? { version: lockedV.v.version, userName: lockedV.lockedBy, at: lockedV.v.lockedAt!.toISOString() } : null,
      updatedAt: p.updatedAt.toISOString(),
    };
    const hasContent = !!current && (!!current.v.content || (files.get(current.v.id) ?? 0) > 0);
    // odkazy na § vyhlášky jen v balíčku CZ (ADR-081)
    item.gaps = withLegalRefs(policyGaps({ ...item, system: p.system, location: p.location, hasContent, requireAcknowledgement: p.requireAcknowledgement }), profiles.get(p.companyId)?.czLegalRefs ?? true);
    out.push({ item, row: p, versions: vs, current, members, ackSet, files, resolve });
  }
  return out;
}

/** Funkční místa přihlášeného uživatele. */
async function myPositions(db: Db, userId: string) {
  return new Set((await db.select({ p: positionHolders.positionId }).from(positionHolders).where(eq(positionHolders.userId, userId))).map((x) => x.p));
}

async function holderCount(db: Db, positionId: string | null) {
  if (!positionId) return 0;
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(positionHolders).where(eq(positionHolders.positionId, positionId));
  return Number(r?.n ?? 0);
}

/** Oprávnění uživatele k dokumentu (role dle funkčních míst + systémová oprávnění). */
async function accessOf(db: Db, c: Ctx, p: PolicyRow) {
  const mine = await myPositions(db, currentUser(c).id);
  const manager = hasPermIn(c, "policies:read", p.companyId);
  const writer = hasPermIn(c, "policies:write", p.companyId);
  const docsApprover = hasPermIn(c, "documents:approve", p.companyId);
  const gestor = !!p.ownerPositionId && mine.has(p.ownerPositionId);
  const isReviewer = !!p.reviewerPositionId && mine.has(p.reviewerPositionId);
  const isApprover = !!p.approverPositionId && mine.has(p.approverPositionId);
  // neobsazené funkční místo nesmí zablokovat oběh – zastoupí ho oprávnění „Schvalovat dokumenty ISMS“
  const reviewerVacant = !!p.reviewerPositionId && (await holderCount(db, p.reviewerPositionId)) === 0;
  const approverVacant = !p.approverPositionId || (await holderCount(db, p.approverPositionId)) === 0;
  return {
    manager,
    editor: writer || gestor,
    gestor,
    canReview: isReviewer || (reviewerVacant && docsApprover),
    canApprove: isApprover || (approverVacant && docsApprover),
    docsApprover,
    roleHolder: gestor || isReviewer || isApprover,
  };
}
type Access = Awaited<ReturnType<typeof accessOf>>;

/** Je dokument viditelný v portálu pro uživatele? (platná verze + klasifikace / okruh dotčených osob) */
async function portalVisible(db: Db, c: Ctx, p: PolicyRow, members?: AudienceMember[]) {
  if (p.status !== "active") return { visible: false, member: false };
  if (!scopeOf(c).accessible.includes(p.companyId)) return { visible: false, member: false };
  const m = members ?? (await audienceMembers(db, p.companyId, p.audience));
  const member = m.some((x) => x.userId === currentUser(c).id);
  return { visible: member || PUBLIC_CLASSES.has(p.classification), member };
}

/** Smí uživatel číst platný dokument? (správce dokumentace dané společnosti vše, ostatní podle pravidel portálu) */
export function docVisibility(db: Db, c: Ctx) {
  return async (pid: string) => {
    const [p] = await db.select().from(policies).where(eq(policies.id, pid));
    return !!p && (hasPermIn(c, "policies:read", p.companyId) || (await portalVisible(db, c, p)).visible);
  };
}

/** Soubory verzí: aktuální revize (`history = false`) nebo nahrazené starší revize (`history = true`). */
async function filesOf(db: Db, versionIds: string[], history = false): Promise<Map<string, PolicyFileDto[]>> {
  const m = new Map<string, PolicyFileDto[]>();
  if (!versionIds.length) return m;
  const rows = await db
    .select({
      f: { id: policyFiles.id, versionId: policyFiles.versionId, filename: policyFiles.filename, mime: policyFiles.mime, size: policyFiles.size, sha256: policyFiles.sha256, uploadedAt: policyFiles.uploadedAt, revision: policyFiles.revision, note: policyFiles.note, replacesId: policyFiles.replacesId, pdfStatus: policyFiles.pdfStatus, pdfError: policyFiles.pdfError },
      hasText: sql<boolean>`${policyFiles.text} is not null and ${policyFiles.text} <> ''`,
      by: users.displayName,
    })
    .from(policyFiles)
    .leftJoin(users, eq(users.id, policyFiles.uploadedById))
    .where(and(inArray(policyFiles.versionId, versionIds), history ? sql`${policyFiles.supersededAt} is not null` : isNull(policyFiles.supersededAt)))
    .orderBy(history ? desc(policyFiles.uploadedAt) : asc(policyFiles.uploadedAt));
  for (const { f, by, hasText } of rows) {
    const list = m.get(f.versionId) ?? [];
    list.push({
      id: f.id,
      filename: f.filename,
      mime: f.mime,
      size: f.size,
      sha256: f.sha256,
      uploadedAt: f.uploadedAt.toISOString(),
      uploadedByName: by,
      revision: f.revision,
      note: f.note,
      replacesId: f.replacesId,
      pdf: f.pdfStatus as PdfStatus,
      pdfError: f.pdfError,
      hasText: !!hasText,
    });
    m.set(f.versionId, list);
  }
  return m;
}

async function quizOf(db: Db, policyId: string, withAnswers: boolean): Promise<QuizQuestionDto[]> {
  const rows = await db.select().from(policyQuizQuestions).where(eq(policyQuizQuestions.policyId, policyId)).orderBy(asc(policyQuizQuestions.position));
  return rows.map((q) => ({ question: q.question, options: q.options, multiple: q.correct.length > 1, ...(withAnswers ? { correct: q.correct } : {}) }));
}

/** Vyhodnocení testu – otázka je správně, jen když sedí přesně množina správných odpovědí. */
export function scoreQuiz(questions: { correct: number[] }[], answers: number[][]) {
  if (!questions.length) return { score: 100, correct: 0 };
  let ok = 0;
  questions.forEach((q, i) => {
    const a = [...new Set(answers[i] ?? [])].sort().join(",");
    if (a === [...q.correct].sort().join(",")) ok++;
  });
  return { score: Math.round((ok / questions.length) * 100), correct: ok };
}

async function commentsOf(db: Db, where: SQL, userId: string): Promise<PolicyCommentDto[]> {
  const rows = await db
    .select({ c: policyComments, version: policyVersions.version, authorName: author.displayName, responderName: responder.displayName })
    .from(policyComments)
    .leftJoin(policyVersions, eq(policyVersions.id, policyComments.versionId))
    .leftJoin(author, eq(author.id, policyComments.userId))
    .leftJoin(responder, eq(responder.id, policyComments.respondedById))
    .where(where)
    .orderBy(desc(policyComments.createdAt));
  return rows.map(({ c, version, authorName, responderName }) => ({
    id: c.id,
    policyId: c.policyId,
    version,
    reference: c.reference,
    text: c.text,
    status: c.status as PolicyCommentDto["status"],
    response: c.response,
    authorName,
    respondedByName: responderName,
    createdAt: c.createdAt.toISOString(),
    respondedAt: c.respondedAt?.toISOString() ?? null,
    mine: c.userId === userId,
  }));
}

export function policyRoutes(db: Db, config: Config = globalConfig) {
  async function row(c: Ctx, id: string): Promise<PolicyRow> {
    const [p] = await db.select().from(policies).where(eq(policies.id, id));
    if (!p) throw new HTTPException(404, { message: "Dokument nenalezen" });
    assertScope(c, p.companyId, "Dokument nenalezen");
    return p;
  }

  async function versionRow(policyId: string, vid: string): Promise<VersionRow> {
    const [v] = await db.select().from(policyVersions).where(and(eq(policyVersions.id, vid), eq(policyVersions.policyId, policyId)));
    if (!v) throw new HTTPException(404, { message: "Verze nenalezena" });
    return v;
  }

  /** Správa dokumentu: správce dokumentace nebo držitel role (gestor / vlastník procesu / schvalovatel). */
  async function managed(c: Ctx, id: string) {
    const p = await row(c, id);
    const a = await accessOf(db, c, p);
    if (!a.manager && !a.roleHolder && !a.docsApprover) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
    return { p, a };
  }
  const needEditor = (a: Access, p?: PolicyRow) => {
    if (!a.editor) throw new HTTPException(403, { message: "Dokument může upravovat správce dokumentace nebo gestor." });
    if (p?.disposedAt) throw new HTTPException(409, { message: "Dokument byl skartován / předán do archivu – nelze ho měnit." });
  };

  /** Návrh verze smí měnit jen ten, kdo ho má rezervovaný (nebo kdokoli, pokud rezervace není). */
  async function draftFor(c: Ctx, policyId: string, vid: string) {
    const v = await versionRow(policyId, vid);
    if (v.status !== "draft") throw new HTTPException(409, { message: "Měnit lze jen návrh verze." });
    if (v.lockedById && v.lockedById !== currentUser(c).id) {
      const [u] = await db.select({ n: users.displayName }).from(users).where(eq(users.id, v.lockedById));
      throw u?.n != null
        ? new ApiError(409, "err.policies.lockedBy", { name: String(u.n), since: v.lockedAt?.toLocaleString("cs-CZ") ?? "?" })
        : new ApiError(409, "err.policies.lockedByOther", { since: v.lockedAt?.toLocaleString("cs-CZ") ?? "?" });
    }
    return v;
  }

  /** Funkční místa rolí oběhu musí patřit do společnosti dokumentu (nebo nadřazené). */
  async function checkPositions(companyId: string, ids: (string | null | undefined)[]) {
    const u = [...new Set(ids.filter((x): x is string => !!x))];
    if (!u.length) return;
    const ok = await db
      .select({ id: positions.id })
      .from(positions)
      .innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId))
      .where(and(inArray(positions.id, u), inArray(orgUnits.companyId, await lineage(companyId))));
    if (ok.length !== u.length) throw new HTTPException(400, { message: "Funkční místo nepatří do společnosti dokumentu." });
  }

  /** Složka musí patřit stejné společnosti jako dokument. */
  async function checkFolder(folderId: string | null | undefined, companyId: string) {
    if (!folderId) return;
    const [f] = await db.select({ companyId: policyFolders.companyId }).from(policyFolders).where(eq(policyFolders.id, folderId));
    if (!f || f.companyId !== companyId) throw new HTTPException(400, { message: "Složka nepatří do společnosti dokumentu." });
  }

  /** Automatické označení: prefix složky (nejbližší nadřazené s prefixem), jinak dle druhu dokumentu. */
  async function autoCode(companyId: string, docType: PolicyRow["docType"], folderId: string | null | undefined) {
    let prefix = DOC_CODE_PREFIX[docType];
    if (folderId) {
      const all = await db.select().from(policyFolders).where(eq(policyFolders.companyId, companyId));
      let cur = all.find((f) => f.id === folderId);
      for (let i = 0; cur && i < 20; i++) {
        if (cur.codePrefix) {
          prefix = cur.codePrefix;
          break;
        }
        cur = all.find((f) => f.id === cur!.parentId);
      }
    }
    const codes = await db.select({ code: policies.code }).from(policies).where(and(eq(policies.companyId, companyId), ilike(policies.code, `${prefix}-%`)));
    return nextDocCode(prefix, codes.map((x) => x.code));
  }

  /** Nový soubor verze (případně nová revize nahrazovaného souboru). */
  async function storeFile(c: Ctx, v: VersionRow, f: { name: string; mime: string; buf: Uint8Array }, replacesId?: string | null, note?: string | null, processNow = true) {
    let revision = 1;
    if (replacesId) {
      const [old] = await db.select().from(policyFiles).where(and(eq(policyFiles.id, replacesId), eq(policyFiles.versionId, v.id), isNull(policyFiles.supersededAt)));
      if (!old) throw new HTTPException(404, { message: "Nahrazovaný soubor nenalezen" });
      revision = old.revision + 1;
      await db.update(policyFiles).set({ supersededAt: new Date() }).where(eq(policyFiles.id, old.id));
    }
    const buf = Buffer.from(f.buf);
    const [row] = await db
      .insert(policyFiles)
      .values({ versionId: v.id, filename: safeFilename(f.name), mime: f.mime, size: buf.length, sha256: createHash("sha256").update(buf).digest("hex"), content: buf, uploadedById: currentUser(c).id, revision, replacesId: replacesId ?? null, note: note ?? null })
      .returning({ id: policyFiles.id, filename: policyFiles.filename, revision: policyFiles.revision });
    // text a PDF na pozadí (převodní služba může chvíli trvat)
    // hromadný import nechá převod plánovači (postupně), jinak hned na pozadí
    if (processNow) void processFile(db, row!.id).catch((e) => console.error("Převod souboru:", (e as Error).message));
    return row!;
  }

  async function readUpload(c: Ctx) {
    if (Number(c.req.header("content-length") ?? 0) > FILE_MAX + 64 * 1024) throw new HTTPException(413, { message: "Soubor je příliš velký (max. 25 MB)" });
    const body = await c.req.parseBody();
    const file = body.file;
    const field = (k: string) => (typeof body[k] === "string" && (body[k] as string).trim() ? (body[k] as string).trim() : null);
    if (file !== undefined && !(file instanceof File)) throw new HTTPException(400, { message: "Vyberte soubor" });
    if (file && file.size > FILE_MAX) throw new HTTPException(413, { message: "Soubor je příliš velký (max. 25 MB)" });
    let upload: { name: string; mime: string; buf: Uint8Array } | null = null;
    if (file && file.size > 0) {
      upload = { name: file.name, mime: mimeFor(file.name), buf: new Uint8Array(await file.arrayBuffer()) };
    }
    return { upload, field };
  }

  async function detail(c: Ctx, id: string): Promise<PolicyDetail> {
    const [x] = await loadPolicies(db, eq(policies.id, id));
    if (!x) throw new HTTPException(404, { message: "Dokument nenalezen" });
    assertScope(c, x.row.companyId, "Dokument nenalezen");
    const a = await accessOf(db, c, x.row);
    const user = currentUser(c);
    const officeRows = x.versions.length
      ? await db
          .select({ s: policyEditSessions, filename: policyFiles.filename })
          .from(policyEditSessions)
          .innerJoin(policyFiles, eq(policyFiles.id, policyEditSessions.fileId))
          .where(and(inArray(policyEditSessions.versionId, x.versions.map((v) => v.v.id)), eq(policyEditSessions.userId, user.id), eq(policyEditSessions.mode, "edit")))
          .orderBy(desc(policyEditSessions.createdAt))
      : [];
    const [ctl, events, fileMap, historyMap, quiz, comments, courses, disposer] = await Promise.all([
      db.select({ id: controls.id, code: controls.code, name: controls.name }).from(policyControls).innerJoin(controls, eq(controls.id, policyControls.controlId)).where(eq(policyControls.policyId, id)),
      x.versions.length
        ? db
            .select({ e: policyEvents, name: users.displayName })
            .from(policyEvents)
            .leftJoin(users, eq(users.id, policyEvents.userId))
            .where(inArray(policyEvents.versionId, x.versions.map((v) => v.v.id)))
            .orderBy(asc(policyEvents.at))
        : Promise.resolve([]),
      filesOf(db, x.versions.map((v) => v.v.id)),
      filesOf(db, x.versions.map((v) => v.v.id), true),
      quizOf(db, id, a.editor || a.manager),
      commentsOf(db, eq(policyComments.policyId, id), user.id),
      db.select({ id: trainingCourses.id, code: trainingCourses.code, title: trainingCourses.title, form: trainingCourses.form }).from(trainingCourses).where(eq(trainingCourses.policyId, id)),
      x.row.disposedById ? db.select({ n: users.displayName }).from(users).where(eq(users.id, x.row.disposedById)) : Promise.resolve([]),
    ]);
    const links = await linksOf(id, x.row.parentId);
    const ackAt = x.current
      ? new Map((await db.select().from(policyAcknowledgements).where(eq(policyAcknowledgements.versionId, x.current.v.id))).map((k) => [k.userId, k.at.toISOString()]))
      : new Map<string, string>();
    const members: AudienceMember[] = x.current ? (x.members.length ? x.members : await audienceMembers(db, x.row.companyId, x.row.audience)) : [];
    const versions: PolicyVersionDto[] = x.versions.map(({ v, approver: approverName, lockedBy, acks }) => {
      const files = fileMap.get(v.id) ?? [];
      const ready = !!v.content || files.length > 0 || !!x.row.location;
      const lockMine = v.lockedById === user.id;
      const free = !v.lockedById || lockMine;
      const editable = v.status === "draft" && a.editor && !x.row.disposedAt;
      return {
        id: v.id,
        version: v.version,
        status: v.status,
        changeSummary: v.changeSummary,
        hasContent: !!v.content,
        effectiveFrom: v.effectiveFrom,
        approvedAt: v.approvedAt?.toISOString() ?? null,
        approvedByName: approverName,
        submittedAt: v.submittedAt?.toISOString() ?? null,
        createdAt: v.createdAt.toISOString(),
        acknowledged: Number(acks),
        files,
        fileHistory: historyMap.get(v.id) ?? [],
        events: events
          .filter((e) => e.e.versionId === v.id)
          .map(({ e, name }): PolicyEventDto => ({ action: e.action as PolicyEventAction, fromStatus: e.fromStatus as PolicyVersionStatus, toStatus: e.toStatus as PolicyVersionStatus, note: e.note, userName: name, at: e.at.toISOString() })),
        lock: v.lockedById && v.lockedAt ? { userName: lockedBy, at: v.lockedAt.toISOString(), mine: lockMine } : null,
        office: (() => {
          // poslední úprava v Office od současné rezervace
          const o = lockMine ? officeRows.find((r) => r.s.versionId === v.id && r.s.createdAt >= v.lockedAt!) : undefined;
          return o ? { open: !o.s.closedAt && o.s.expiresAt > new Date(), saves: o.s.saves, lastSavedAt: o.s.lastSavedAt?.toISOString() ?? null, filename: o.filename } : null;
        })(),
        can: {
          edit: editable && free,
          submit: editable && free && ready,
          review: v.status === "review" && a.canReview,
          approve: v.status === "approval" && a.canApprove,
          directApprove: ["draft", "review", "approval"].includes(v.status) && a.docsApprover && ready && free && !x.row.disposedAt,
          checkout: editable && !v.lockedById,
          checkin: editable && lockMine,
          // rezervaci zruší její držitel, nebo správce dokumentace (např. při nepřítomnosti)
          unlock: v.status === "draft" && !!v.lockedById && (lockMine || hasPermIn(c, "policies:write", x.row.companyId)),
        },
      };
    });
    return {
      ...x.item,
      description: x.row.description,
      reviewMonths: x.row.reviewMonths,
      location: x.row.location,
      audience: x.row.audience,
      requireAcknowledgement: x.row.requireAcknowledgement,
      reviewerPositionId: x.row.reviewerPositionId,
      approverPositionId: x.row.approverPositionId,
      ackDueDays: x.row.ackDueDays,
      retrainOnNewVersion: x.row.retrainOnNewVersion,
      quizPassPct: x.row.quizPassPct,
      quiz,
      comments,
      courses,
      lastReviewNote: x.row.lastReviewNote,
      controls: ctl,
      ...links,
      versions,
      people: members.map((m) => ({ userId: m.userId, name: m.name, acknowledgedAt: ackAt.get(m.userId) ?? null })),
      retentionYears: x.row.retentionYears,
      retentionMark: x.row.retentionMark as RetentionMark | null,
      disposal: x.row.disposedAt
        ? { at: x.row.disposedAt.toISOString(), byName: disposer[0]?.n ?? null, mode: x.row.disposalMode as DisposalMode, note: x.row.disposalNote, reference: x.row.disposalReference }
        : null,
      canEdit: a.editor && !x.row.disposedAt,
    };
  }

  /** Společnosti, jejichž opatření a funkční místa smí dokument používat (vlastní + nadřazené – sdílené zdroje holdingu). */
  async function lineage(companyId: string) {
    return [companyId, ...ancestorsOf(await getCompanies(db), companyId)];
  }

  async function setControls(policyId: string, ids?: string[], companyId?: string) {
    if (!ids) return;
    let u = [...new Set(ids)];
    if (companyId && u.length) {
      const ok = await db.select({ id: controls.id }).from(controls).where(and(inArray(controls.id, u), inArray(controls.companyId, await lineage(companyId))));
      if (ok.length !== u.length) throw new HTTPException(400, { message: "Opatření nepatří do společnosti dokumentu." });
      u = ok.map((x) => x.id);
    }
    await db.delete(policyControls).where(eq(policyControls.policyId, policyId));
    if (u.length) await db.insert(policyControls).values(u.map((controlId) => ({ policyId, controlId })));
  }

  /* ---------- vazby dokumentu (v0.31) ---------- */

  const refCols = { id: policies.id, code: policies.code, title: policies.title, docType: policies.docType, status: policies.status };
  const byCode = <T extends { code: string | null; title?: string; name?: string }>(a: T, b: T) =>
    (a.code ?? "￿").localeCompare(b.code ?? "￿", "cs", { numeric: true }) || (a.title ?? a.name ?? "").localeCompare(b.title ?? b.name ?? "", "cs");

  async function linksOf(id: string, parentId: string | null) {
    const [parent, children, relOut, relIn, reqs, procs, assetRows, riskRows, supRows] = await Promise.all([
      parentId ? db.select(refCols).from(policies).where(eq(policies.id, parentId)) : Promise.resolve([]),
      db.select(refCols).from(policies).where(eq(policies.parentId, id)),
      db.select(refCols).from(policyRelated).innerJoin(policies, eq(policies.id, policyRelated.targetId)).where(eq(policyRelated.policyId, id)),
      db.select(refCols).from(policyRelated).innerJoin(policies, eq(policies.id, policyRelated.policyId)).where(eq(policyRelated.targetId, id)),
      db.select({ id: policyRequirements.requirementId }).from(policyRequirements).where(eq(policyRequirements.policyId, id)),
      db.select({ id: processes.id, code: processes.code, name: processes.name }).from(policyProcesses).innerJoin(processes, eq(processes.id, policyProcesses.targetId)).where(eq(policyProcesses.policyId, id)),
      db.select({ id: assets.id, name: assets.name, assetType: assets.assetType }).from(policyAssets).innerJoin(assets, eq(assets.id, policyAssets.targetId)).where(eq(policyAssets.policyId, id)),
      db.select({ id: risks.id, code: risks.code, name: risks.name }).from(policyRisks).innerJoin(risks, eq(risks.id, policyRisks.targetId)).where(eq(policyRisks.policyId, id)),
      db.select({ id: suppliers.id, name: suppliers.name }).from(policySuppliers).innerJoin(suppliers, eq(suppliers.id, policySuppliers.targetId)).where(eq(policySuppliers.policyId, id)),
    ]);
    const related = [...new Map([...relOut, ...relIn].map((r) => [r.id, r])).values()].sort(byCode);
    return {
      parent: (parent[0] as PolicyRef | undefined) ?? null,
      children: children.sort(byCode) as PolicyRef[],
      related: related as PolicyRef[],
      requirements: reqs
        .map((r) => requirementById(r.id))
        .filter((r) => !!r)
        .map((r) => ({ id: r.id, framework: r.framework, ref: r.ref, text: r.text })),
      processes: procs.sort(byCode),
      assets: assetRows.sort((a, b) => a.name.localeCompare(b.name, "cs")),
      risks: riskRows.sort(byCode),
      suppliers: supRows.sort((a, b) => a.name.localeCompare(b.name, "cs")),
    };
  }

  const LINK_TABLES = {
    processIds: { link: policyProcesses, t: processes, label: "Proces" },
    assetIds: { link: policyAssets, t: assets, label: "Aktivum" },
    riskIds: { link: policyRisks, t: risks, label: "Riziko" },
    supplierIds: { link: policySuppliers, t: suppliers, label: "Dodavatel" },
  } as const;
  type LinkInput = { parentId?: string | null; relatedIds?: string[]; requirementIds?: string[] } & Partial<Record<keyof typeof LINK_TABLES, string[]>>;

  /** Nastaví vazby dokumentu; cíle musí patřit společnosti dokumentu nebo nadřazeným (sdílené zdroje holdingu). */
  async function setLinks(policyId: string, companyId: string, v: LinkInput) {
    const allowed = await lineage(companyId);
    if (v.parentId !== undefined) {
      if (v.parentId) {
        const [par] = await db.select({ id: policies.id, companyId: policies.companyId }).from(policies).where(eq(policies.id, v.parentId));
        if (!par || !allowed.includes(par.companyId)) throw new HTTPException(400, { message: "Nadřazený dokument nepatří do společnosti dokumentu." });
        const tree = await db.select({ id: policies.id, parentId: policies.parentId }).from(policies).where(inArray(policies.companyId, allowed));
        if (parentCycle(tree, policyId, v.parentId)) throw new HTTPException(400, { message: "Nadřazený dokument nemůže být tento dokument ani dokument pod ním." });
      }
      await db.update(policies).set({ parentId: v.parentId }).where(eq(policies.id, policyId));
    }
    if (v.relatedIds) {
      const ids = [...new Set(v.relatedIds)].filter((x) => x !== policyId);
      if (ids.length) {
        const ok = await db.select({ id: policies.id }).from(policies).where(and(inArray(policies.id, ids), inArray(policies.companyId, allowed)));
        if (ok.length !== ids.length) throw new HTTPException(400, { message: "Související dokument nepatří do společnosti dokumentu." });
      }
      // obousměrná vazba: smazat oba směry, uložit jednou
      await db.delete(policyRelated).where(or(eq(policyRelated.policyId, policyId), eq(policyRelated.targetId, policyId)));
      if (ids.length) await db.insert(policyRelated).values(ids.map((targetId) => ({ policyId, targetId })));
    }
    if (v.requirementIds) {
      const ids = [...new Set(v.requirementIds)];
      const unknown = ids.filter((x) => !requirementById(x));
      if (unknown.length) throw new ApiError(400, "err.req.unknownList", { ids: unknown.slice(0, 3).join(", ") });
      await db.delete(policyRequirements).where(eq(policyRequirements.policyId, policyId));
      if (ids.length) await db.insert(policyRequirements).values(ids.map((requirementId) => ({ policyId, requirementId })));
    }
    for (const key of Object.keys(LINK_TABLES) as (keyof typeof LINK_TABLES)[]) {
      const list = v[key];
      if (!list) continue;
      const { link, t, label } = LINK_TABLES[key];
      const ids = [...new Set(list)];
      if (ids.length) {
        const ok = await db.select({ id: t.id }).from(t).where(and(inArray(t.id, ids), inArray(t.companyId, allowed)));
        if (ok.length !== ids.length) throw new ApiError(400, key === "processIds" ? "err.policies.linkCompanyProcess" : key === "assetIds" ? "err.policies.linkCompanyAsset" : key === "riskIds" ? "err.policies.linkCompanyRisk" : "err.policies.linkCompanySupplier");
      }
      await db.delete(link).where(eq(link.policyId, policyId));
      if (ids.length) await db.insert(link).values(ids.map((targetId) => ({ policyId, targetId })));
    }
  }

  /* ---------- hromadný import (v0.32, ADR-033) ---------- */

  async function importInput(c: Ctx) {
    if (Number(c.req.header("content-length") ?? 0) > IMPORT_ZIP_MAX + 64 * 1024) throw new HTTPException(413, { message: "Archiv je příliš velký (max. 100 MB)." });
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File) || !file.size) throw new HTTPException(400, { message: "Vyberte ZIP archiv." });
    if (file.size > IMPORT_ZIP_MAX) throw new HTTPException(413, { message: "Archiv je příliš velký (max. 100 MB)." });
    let options: unknown = {};
    if (typeof body.options === "string" && body.options.trim()) {
      try {
        options = JSON.parse(body.options);
      } catch {
        throw new HTTPException(400, { message: "Neplatné volby importu." });
      }
    }
    const opts = DocImportOptions.safeParse(options);
    if (!opts.success) throw new HTTPException(400, { message: "Neplatné volby importu." });
    let archive;
    try {
      archive = readImportZip(new Uint8Array(await file.arrayBuffer()));
    } catch (e) {
      throw new HTTPException(400, { message: (e as Error).message });
    }
    return { archive, opts: opts.data, mode: body.mode === "commit" ? ("commit" as const) : ("preview" as const) };
  }

  async function importContext(companyId: string) {
    const [codes, pos] = await Promise.all([
      db.select({ code: policies.code }).from(policies).where(eq(policies.companyId, companyId)),
      db.select({ id: positions.id, name: positions.name }).from(positions).innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId)).where(inArray(orgUnits.companyId, await lineage(companyId))),
    ]);
    return { existing: new Set(codes.filter((x) => x.code).map((x) => x.code!.toLowerCase())), positions: pos };
  }

  /** Složka podle názvu pod rodičem (založí se, pokud chybí). */
  async function ensureFolder(companyId: string, parentId: string | null, name: string) {
    const [f] = await db
      .select({ id: policyFolders.id })
      .from(policyFolders)
      .where(and(eq(policyFolders.companyId, companyId), parentId ? eq(policyFolders.parentId, parentId) : isNull(policyFolders.parentId), eq(policyFolders.name, name)));
    if (f) return f.id;
    const [n] = await db.insert(policyFolders).values({ companyId, parentId, name }).returning({ id: policyFolders.id });
    return n!.id;
  }

  /** Dokumenty navázané na záznam (karta procesu, aktiva, rizika, dodavatele, opatření, požadavku). */
  async function linkedTo(c: Ctx, kind: PolicyLinkKind, id: string): Promise<PolicyRef[]> {
    let ids: string[];
    if (kind === "requirement") ids = (await db.select({ id: policyRequirements.policyId }).from(policyRequirements).where(eq(policyRequirements.requirementId, id))).map((x) => x.id);
    else if (kind === "control") ids = (await db.select({ id: policyControls.policyId }).from(policyControls).where(eq(policyControls.controlId, id))).map((x) => x.id);
    else {
      const link = { process: policyProcesses, asset: policyAssets, risk: policyRisks, supplier: policySuppliers }[kind];
      ids = (await db.select({ id: link.policyId }).from(link).where(eq(link.targetId, id))).map((x) => x.id);
    }
    if (!ids.length) return [];
    const rows = await db
      .select({ ...refCols, currentVersion: policyVersions.version })
      .from(policies)
      .leftJoin(policyVersions, and(eq(policyVersions.policyId, policies.id), eq(policyVersions.status, "approved")))
      .where(and(inArray(policies.id, ids), inScope(c, policies.companyId)));
    return rows.sort(byCode);
  }

  async function event(versionId: string, action: PolicyEventAction, from: PolicyVersionStatus, to: PolicyVersionStatus, userId: string, note?: string | null) {
    await db.insert(policyEvents).values({ versionId, action, fromStatus: from, toStatus: to, userId, note: note ?? null });
  }

  /** Text verze pro porovnání: text v CONTIXu + text souborů (aktuální revize). */
  async function versionText(vid: string) {
    const [v] = await db.select({ content: policyVersions.content }).from(policyVersions).where(eq(policyVersions.id, vid));
    const files = await db
      .select({ filename: policyFiles.filename, mime: policyFiles.mime, text: policyFiles.text, status: policyFiles.pdfStatus })
      .from(policyFiles)
      .where(and(eq(policyFiles.versionId, vid), isNull(policyFiles.supersededAt)))
      .orderBy(asc(policyFiles.uploadedAt));
    const missing = files.filter((f) => !f.text && fileKind(f.filename, f.mime) !== "other").map((f) => f.filename);
    // Word a jeho PDF export mají stejný text – porovnává se jen jeden z dvojice
    const base = (n: string) => n.replace(/\.[^.]+$/, "").toLowerCase();
    const office = new Set(files.filter((f) => f.text && fileKind(f.filename, f.mime) === "office").map((f) => base(f.filename)));
    // Markdown → prostý text (značky by v porovnání rušily)
    const md = (v?.content ?? "").replace(/^\s{0,3}#{1,6}\s+/gm, "").replace(/^\s*[-*+]\s+/gm, "• ").replace(/\*\*|__|`/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
    const parts = [md, ...files.filter((f) => f.text && !(fileKind(f.filename, f.mime) === "pdf" && office.has(base(f.filename)))).map((f) => f.text!)];
    return { text: parts.filter(Boolean).join("\n\n"), missing };
  }

  async function diffVersions(policyId: string, fromId: string, toId: string): Promise<VersionDiffDto> {
    const vs = await db.select({ id: policyVersions.id, version: policyVersions.version }).from(policyVersions).where(and(eq(policyVersions.policyId, policyId), inArray(policyVersions.id, [fromId, toId])));
    const from = vs.find((x) => x.id === fromId);
    const to = vs.find((x) => x.id === toId);
    if (!from || !to) throw new HTTPException(404, { message: "Verze nenalezena" });
    const [a, b] = [await versionText(fromId), await versionText(toId)];
    const d = diffText(a.text, b.text);
    return { from, to, blocks: d.blocks, stats: d.stats, truncated: d.truncated, missingText: [...new Set([...a.missing, ...b.missing])] };
  }

  /** Doložka a vodoznak podle aktuálního stavu verze a dokumentu. */
  async function stampFor(c: Ctx, p: PolicyRow, v: VersionRow) {
    const [approverRow] = v.approvedById ? await db.select({ n: users.displayName }).from(users).where(eq(users.id, v.approvedById)) : [];
    const [next] =
      v.status === "superseded"
        ? await db
            .select({ version: policyVersions.version })
            .from(policyVersions)
            .where(and(eq(policyVersions.policyId, p.id), eq(policyVersions.status, "approved")))
        : [];
    const t = await tFor(db, c);
    const loc = t.locale === "cs" ? "cs-CZ" : t.locale;
    const day = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleDateString(loc) : "—");
    const name = `${p.code ? `${p.code} ` : ""}${p.title}`;
    const valid = v.status === "approved" && p.status === "active";
    const state = valid
      ? t("srv.pol.stampValid")
      : v.status === "approved" || v.status === "superseded"
        ? next
          ? t("srv.pol.stampSuperseded", { version: next.version })
          : p.status === "retired"
            ? t("srv.pol.stampRetired")
            : t("srv.pol.stampInvalid")
        : t("srv.pol.stampDraft", { status: t.lbl(POLICY_LABELS.versionStatus[v.status]) });
    return {
      footer: [
        t("srv.pol.stampLine", { name, version: v.version, state }),
        v.approvedAt ? t("srv.pol.stampApproved", { approver: approverRow?.n ?? "?", date: day(v.approvedAt), effective: day(v.effectiveFrom) }) : t("srv.pol.stampUnapproved"),
        t("srv.pol.stampDownloaded", { date: new Date().toLocaleString(loc), user: currentUser(c).displayName }),
      ],
      watermark: valid ? null : v.status === "approved" || v.status === "superseded" ? t("srv.pol.wmInvalid") : t("srv.pol.wmDraft"),
    };
  }

  /** Přístup k souboru verze: správa dokumentu, nebo platná verze v portálu (jen aktuální revize). */
  async function fileAccess(c: Ctx, id: string, vid: string, fid: string) {
    const [p] = await db.select().from(policies).where(eq(policies.id, id));
    if (!p) throw new HTTPException(404, { message: "Soubor nenalezen" });
    const v = await versionRow(id, vid);
    const [f] = await db.select().from(policyFiles).where(and(eq(policyFiles.id, fid), eq(policyFiles.versionId, vid)));
    if (!f) throw new HTTPException(404, { message: "Soubor nenalezen" });
    let ok = false;
    try {
      assertScope(c, p.companyId);
      const a = await accessOf(db, c, p);
      ok = a.manager || a.roleHolder || a.docsApprover;
    } catch {
      ok = false;
    }
    if (!ok) ok = v.status === "approved" && !f.supersededAt && (await portalVisible(db, c, p)).visible;
    if (!ok) throw new HTTPException(404, { message: "Soubor nenalezen" });
    return { p, v, f };
  }

  /** Schválení verze: předchozí platná se nahradí, dokument je platný. */
  async function approveVersion(c: Ctx, p: PolicyRow, v: VersionRow, action: "approve" | "direct_approve", note?: string | null) {
    const user = currentUser(c);
    await db.transaction(async (tx) => {
      await tx.update(policyVersions).set({ status: "superseded", updatedAt: new Date() }).where(and(eq(policyVersions.policyId, p.id), eq(policyVersions.status, "approved")));
      await tx
        .update(policyVersions)
        .set({ status: "approved", approvedAt: new Date(), approvedById: user.id, effectiveFrom: v.effectiveFrom ?? today(), lockedById: null, lockedAt: null, updatedAt: new Date() })
        .where(eq(policyVersions.id, v.id));
      await tx.update(policies).set({ status: "active", retiredAt: null, lastReviewedAt: today(), lastReviewNote: `Schválena verze ${v.version}`, updatedAt: new Date() }).where(eq(policies.id, p.id));
    });
    await closeOfficeSessions(db, v.id);
    await event(v.id, action, v.status, "approved", user.id, note);
    await audit(db, { c, user, action: "policy.approved", entityType: "policy", entityId: p.id, details: { version: v.version, via: action } });
    // nová platná verze do „Zeptej se dokumentace“ (na pozadí)
    void indexPolicy(db, config, p.id).catch((e) => console.error("Indexace dokumentu:", (e as Error).message));
  }

  /** Dokumenty k seznámení pro přihlášeného uživatele (napříč společnostmi). */
  async function mine(userId: string): Promise<MyPolicyItem[]> {
    const list = await loadPolicies(db, and(eq(policies.status, "active"), eq(policies.requireAcknowledgement, true)));
    const out: MyPolicyItem[] = [];
    for (const x of list) {
      if (!x.current || !x.members.some((m) => m.userId === userId)) continue;
      out.push({
        policyId: x.row.id,
        versionId: x.current.v.id,
        code: x.row.code,
        title: x.row.title,
        version: x.current.v.version,
        docType: x.row.docType,
        approvedAt: x.item.approvedAt,
        location: x.row.location,
        hasContent: !!x.current.v.content || (x.files.get(x.current.v.id) ?? 0) > 0,
        acknowledgedAt: x.ackSet.has(userId)
          ? ((await db.select({ at: policyAcknowledgements.at }).from(policyAcknowledgements).where(and(eq(policyAcknowledgements.versionId, x.current.v.id), eq(policyAcknowledgements.userId, userId))))[0]?.at.toISOString() ?? null)
          : null,
      });
    }
    return out.sort((a, b) => Number(!!a.acknowledgedAt) - Number(!!b.acknowledgedAt) || a.title.localeCompare(b.title, "cs"));
  }

  /* ---------- portál ---------- */

  /** Stav uživatele k platným verzím hromadně: testy, splněné testy a seznámení (bez dotazů na každý dokument). */
  async function portalState(userId: string, list: Awaited<ReturnType<typeof loadPolicies>>) {
    const pids = list.map((x) => x.row.id);
    const vids = list.flatMap((x) => (x.current ? [x.current.v.id] : []));
    const [quiz, passed, acks] = await Promise.all([
      pids.length ? db.selectDistinct({ p: policyQuizQuestions.policyId }).from(policyQuizQuestions).where(inArray(policyQuizQuestions.policyId, pids)) : [],
      vids.length ? db.selectDistinct({ v: policyQuizAttempts.versionId }).from(policyQuizAttempts).where(and(inArray(policyQuizAttempts.versionId, vids), eq(policyQuizAttempts.userId, userId), eq(policyQuizAttempts.passed, true))) : [],
      vids.length ? db.select({ v: policyAcknowledgements.versionId, at: policyAcknowledgements.at }).from(policyAcknowledgements).where(and(inArray(policyAcknowledgements.versionId, vids), eq(policyAcknowledgements.userId, userId))) : [],
    ]);
    return { quiz: new Set(quiz.map((x) => x.p)), passed: new Set(passed.map((x) => x.v)), acks: new Map(acks.map((x) => [x.v, x.at])) };
  }

  async function portalItem(c: Ctx, x: Awaited<ReturnType<typeof loadPolicies>>[number], fileMap: Map<string, PolicyFileDto[]>, state?: Awaited<ReturnType<typeof portalState>>): Promise<PortalDocItem | null> {
    if (!x.current) return null;
    const members = x.row.requireAcknowledgement ? x.members : x.resolve(x.row.companyId, x.row.audience);
    const vis = await portalVisible(db, c, x.row, members);
    if (!vis.visible) return null;
    const st = state ?? (await portalState(currentUser(c).id, [x]));
    const hasQuiz = st.quiz.has(x.row.id);
    const passed = hasQuiz && st.passed.has(x.current.v.id);
    const ackAt = st.acks.get(x.current.v.id);
    const ack = ackAt ? { at: ackAt } : undefined;
    const must = x.row.requireAcknowledgement && vis.member;
    return {
      id: x.row.id,
      companyId: x.row.companyId,
      code: x.row.code,
      title: x.row.title,
      docType: x.row.docType,
      classification: x.row.classification,
      folderId: x.row.folderId,
      folderPath: x.item.folderPath,
      version: x.current.v.version,
      versionId: x.current.v.id,
      approvedAt: x.item.approvedAt,
      effectiveFrom: x.current.v.effectiveFrom,
      ownerPositionName: x.item.ownerPositionName,
      description: x.row.description,
      sections: x.row.sections,
      mustAcknowledge: must,
      acknowledgedAt: ack?.at.toISOString() ?? null,
      ackDue: must && x.item.approvedAt ? addDays(x.item.approvedAt, x.row.ackDueDays) : null,
      hasQuiz,
      quizPassed: !!passed,
      hasContent: !!x.current.v.content,
      files: fileMap.get(x.current.v.id) ?? [],
      location: x.row.location,
      snippet: null,
    };
  }

  /** Úryvek s hledaným výrazem z textu verze nebo jejích souborů. */
  async function snippetOf(vid: string, content: string | null, q: string): Promise<string | null> {
    const needle = normalizeSearch(q.trim());
    if (!needle) return null;
    if (content) {
      const t = content.normalize("NFC");
      const s = snippetAround(t, normalizeSearch(t), needle);
      if (s) return s;
    }
    const [f] = await db
      .select({ text: policyFiles.text, search: policyFiles.searchText })
      .from(policyFiles)
      .where(and(eq(policyFiles.versionId, vid), isNull(policyFiles.supersededAt), sql`${policyFiles.searchText} like ${`%${likeEsc(needle)}%`}`))
      .limit(1);
    return f?.text && f.search ? snippetAround(f.text, f.search, needle) : null;
  }

  /** Předchozí platná verze (naposledy nahrazená před aktuální). */
  const previousOf = (x: Awaited<ReturnType<typeof loadPolicies>>[number]) =>
    x.versions
      .filter((v) => v.v.status === "superseded" && v.v.approvedAt)
      .sort((a, b) => b.v.approvedAt!.getTime() - a.v.approvedAt!.getTime())[0] ?? null;

  async function portalDoc(c: Ctx, id: string) {
    const [x] = await loadPolicies(db, eq(policies.id, id));
    if (!x) throw new HTTPException(404, { message: "Dokument nenalezen" });
    const item = await portalItem(c, x, await filesOf(db, x.current ? [x.current.v.id] : []));
    if (!item) throw new HTTPException(404, { message: "Dokument nenalezen" });
    return { x, item };
  }

  /** Zápis seznámení a absolvování navázaných kurzů formy „Seznámení s dokumentem“. */
  async function recordAcknowledgement(c: Ctx, p: PolicyRow, v: VersionRow, score: number | null) {
    const user = currentUser(c);
    await db.insert(policyAcknowledgements).values({ versionId: v.id, userId: user.id }).onConflictDoNothing();
    const courses = await db.select().from(trainingCourses).where(and(eq(trainingCourses.policyId, p.id), eq(trainingCourses.active, true), eq(trainingCourses.form, "document")));
    const since = v.approvedAt?.toISOString().slice(0, 10) ?? today();
    for (const course of courses) {
      const [done] = await db
        .select({ id: trainingRecords.id })
        .from(trainingRecords)
        .where(and(eq(trainingRecords.courseId, course.id), eq(trainingRecords.userId, user.id), gte(trainingRecords.completedAt, since), eq(trainingRecords.passed, true)))
        .limit(1);
      if (!done)
        await db.insert(trainingRecords).values({
          courseId: course.id,
          userId: user.id,
          completedAt: today(),
          score,
          passed: true,
          note: `Seznámení s dokumentem ${p.code ? `${p.code} ` : ""}${p.title}, verze ${v.version}`,
          recordedById: user.id,
        });
    }
    await audit(db, { c, user, action: "policy.acknowledged", entityType: "policy", entityId: p.id, details: { version: v.version, score } });
  }

  async function sendFile(c: Ctx, f: typeof policyFiles.$inferSelect, inline: boolean) {
    // PDF lze zobrazit v prohlížeči; ostatní typy vždy jako příloha
    const isPdf = f.mime === "application/pdf" && f.content.subarray(0, 5).toString() === "%PDF-";
    const disp = inline && isPdf ? "inline" : "attachment";
    await audit(db, { c, user: currentUser(c), action: "policy.file_downloaded", entityType: "policy_file", entityId: f.id, details: { filename: f.filename } });
    return new Response(new Uint8Array(f.content), {
      headers: {
        "content-type": isPdf ? "application/pdf" : f.mime,
        "content-length": String(f.size),
        "content-disposition": `${disp}; filename="${f.filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
        "x-content-type-options": "nosniff",
        ...(disp === "attachment" ? { "content-security-policy": "sandbox; default-src 'none'" } : {}),
        "cache-control": "private, no-store",
      },
    });
  }

  const ANY: Permission[] = ["policies:read", "obligations:self"];

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "policies"))
      .get("/", requirePerm("policies:read"), async (c) => c.json((await loadPolicies(db, inScope(c, policies.companyId))).map((x) => x.item)))

      /** Pokrytí oddílů vyhlášky platnou dokumentací (§ 6 odst. 1). */
      .get("/coverage", requirePerm("policies:read"), async (c) => {
        const s = await settingsFor(db, c);
        const decree = profileOf(s).defaultFramework;
        const q = c.req.query("framework");
        // výchozí = vyhláška podle režimu; jinak libovolný rámec (ISO 27001, DORA, ISO 9001…) přes navázané požadavky
        const fw = q && frameworkExists(q) ? (q as FrameworkId) : decree;
        const reqs = requirementsOf(fw);
        const sections = new Map<string, string>();
        for (const r of reqs) if (!sections.has(r.section)) sections.set(r.section, r.sectionTitle);
        const list = (await loadPolicies(db, and(inScope(c, policies.companyId), eq(policies.status, "active")), { withAck: false })).filter((x) => x.current);
        const bySection = new Map<string, Set<string>>();
        const add = (sec: string, id: string) => bySection.set(sec, (bySection.get(sec) ?? new Set()).add(id));
        // oddíly dokumentu se vztahují k vyhlášce podle režimu společnosti
        if (fw === decree) for (const x of list) for (const sec of x.row.sections) if (sections.has(sec)) add(sec, x.row.id);
        if (list.length) {
          const sectionOf = new Map(reqs.map((r) => [r.id, r.section]));
          const links = await db.select().from(policyRequirements).where(inArray(policyRequirements.policyId, list.map((x) => x.row.id)));
          for (const l of links) {
            const sec = sectionOf.get(l.requirementId);
            if (sec) add(sec, l.policyId);
          }
        }
        const out: PolicyCoverageRow[] = [...sections].map(([section, title]) => ({ section, title, documents: bySection.get(section)?.size ?? 0 }));
        return c.json(out);
      })

      /** Dokumenty navázané na záznam – zobrazení na kartě procesu, aktiva, rizika, dodavatele, opatření a požadavku. */
      .get("/linked", requirePerm("policies:read"), async (c) => {
        const kind = c.req.query("kind") as PolicyLinkKind;
        const id = c.req.query("id")?.trim() ?? "";
        if (!(POLICY_LINK_KINDS as readonly string[]).includes(kind) || !id || id.length > 100) throw new HTTPException(400, { message: "Neplatný dotaz" });
        if (kind !== "requirement" && !/^[0-9a-f-]{36}$/i.test(id)) throw new HTTPException(400, { message: "Neplatný dotaz" });
        return c.json(await linkedTo(c, kind, id));
      })

      /** Hromadný import dokumentace: ZIP (tabulka metadat + soubory) → náhled (mode=preview) nebo založení (mode=commit). */
      .post("/import", requirePerm("policies:write"), async (c) => {
        const companyId = targetCompany(c, undefined, "policies:write");
        const { archive, opts, mode } = await importInput(c);
        const ctx = await importContext(companyId);
        // oddíly ISMS v tabulce se párují na českou vyhlášku jen v balíčku CZ
        const decree = czDecreeOf(profileOf(await settingsFor(db, c))) ?? "cz409";
        const preview = buildPreview(archive, ctx.existing, ctx.positions, decree);
        if (mode === "preview") return c.json(preview);

        const user = currentUser(c);
        await checkFolder(opts.folderId, companyId);
        const mapped = (name: string | null) => (name ? (opts.mapping[name] ?? preview.roles.find((r) => r.name === name)?.positionId ?? null) : null);
        await checkPositions(companyId, Object.values(opts.mapping));
        const result: DocImportResultDto = { created: [], skipped: [], linkedParents: 0, files: 0 };
        const t = await tFor(db, c);
        const idByCode = new Map<string, string>();
        const folderByType = new Map<string, string>();
        for (const r of preview.rows) {
          if (r.errors.length) {
            result.skipped.push({ line: r.line, code: r.code, reason: r.errors.join(" ") });
            continue;
          }
          if (r.exists) {
            result.skipped.push({ line: r.line, code: r.code, reason: t("srv.pol.importExists") });
            continue;
          }
          const docType = r.docType!;
          let folderId = opts.folderId ?? null;
          if (opts.foldersByType) {
            if (!folderByType.has(docType)) folderByType.set(docType, await ensureFolder(companyId, folderId, LABELS_ALL.type[docType]));
            folderId = folderByType.get(docType)!;
          }
          const code = r.code ?? (await autoCode(companyId, docType, folderId));
          const [p] = await db
            .insert(policies)
            .values({
              companyId,
              code,
              title: r.title,
              docType,
              system: r.system,
              status: "draft",
              description: r.description,
              sections: r.sections,
              ownerPositionId: mapped(r.owner),
              reviewerPositionId: mapped(r.reviewer),
              approverPositionId: mapped(r.approver),
              reviewMonths: r.reviewMonths,
              classification: r.classification,
              requireAcknowledgement: opts.requireAcknowledgement && docType !== "record",
              folderId,
            })
            .returning();
          const [v] = await db.insert(policyVersions).values({ policyId: p!.id, version: r.version, changeSummary: "Import dokumentace", createdById: user.id }).returning();
          if (r.requirementIds.length) await db.insert(policyRequirements).values(r.requirementIds.map((requirementId) => ({ policyId: p!.id, requirementId })));
          if (r.file) {
            const buf = archive.files.get(r.file)!;
            if (buf.length > FILE_MAX) result.skipped.push({ line: r.line, code, reason: t("srv.pol.importFileTooBig", { file: r.file }) });
            else {
              const name = r.file.split("/").pop()!;
              await storeFile(c, v!, { name, mime: mimeFor(name), buf }, null, null, false);
              result.files++;
            }
          }
          idByCode.set(code.toLowerCase(), p!.id);
          result.created.push({ id: p!.id, code, title: p!.title });
          await audit(db, { c, user, action: "policy.imported", entityType: "policy", entityId: p!.id, details: { code, title: p!.title, file: r.file, source: preview.metadataFile } });
        }
        // nadřazené dokumenty (v importu nebo existující ve společnosti)
        const parents = preview.rows.filter((r) => r.parentCode && r.code && idByCode.has(r.code.toLowerCase()));
        if (parents.length) {
          const existing = await db.select({ id: policies.id, code: policies.code }).from(policies).where(eq(policies.companyId, companyId));
          const all = new Map(existing.filter((x) => x.code).map((x) => [x.code!.toLowerCase(), x.id]));
          for (const r of parents) {
            const pid = all.get(r.parentCode!.toLowerCase());
            const id = idByCode.get(r.code!.toLowerCase())!;
            if (pid && pid !== id) {
              await db.update(policies).set({ parentId: pid }).where(eq(policies.id, id));
              result.linkedParents++;
            }
          }
        }
        await audit(db, { c, user, action: "policy.import_finished", entityType: "policy", details: { source: preview.metadataFile, created: result.created.length, skipped: result.skipped.length, files: result.files } });
        // text a PDF souborů postupně na pozadí
        if (result.files) void processPendingFiles(db).catch((e) => console.error("Převod importovaných souborů:", (e as Error).message));
        return c.json(result, 201);
      })

      /** Fulltext v dokumentaci (správa): text verzí i obsah souborů všech verzí, vč. návrhů. */
      .get("/search", requirePerm("policies:read"), async (c) => {
        const q = c.req.query("q")?.trim() ?? "";
        if (q.length < 3) return c.json([]);
        const needle = normalizeSearch(q);
        const like = `%${likeEsc(needle)}%`;
        const rows = await db
          .select({ p: { id: policies.id, companyId: policies.companyId, code: policies.code, title: policies.title, status: policies.status }, v: { id: policyVersions.id, version: policyVersions.version, status: policyVersions.status, content: policyVersions.content }, file: policyFiles.filename, text: policyFiles.text, search: policyFiles.searchText })
          .from(policyVersions)
          .innerJoin(policies, eq(policies.id, policyVersions.policyId))
          .leftJoin(policyFiles, and(eq(policyFiles.versionId, policyVersions.id), isNull(policyFiles.supersededAt), sql`${policyFiles.searchText} like ${like}`))
          .where(and(inScope(c, policies.companyId), or(sql`${policyFiles.id} is not null`, ilike(policyVersions.content, `%${likeEsc(q)}%`))))
          .orderBy(desc(policyVersions.createdAt))
          .limit(200);
        const out: PolicySearchHit[] = [];
        for (const r of rows) {
          if (out.length >= 50) break;
          let snippet: string | null = null;
          let source = "text verze";
          if (r.file && r.text && r.search) {
            snippet = snippetAround(r.text, r.search, needle);
            source = r.file;
          } else if (r.v.content) {
            const t = r.v.content.normalize("NFC");
            snippet = snippetAround(t, normalizeSearch(t), needle);
          }
          if (snippet && !out.some((o) => o.id === r.p.id && o.version === r.v.version && o.source === source))
            out.push({ id: r.p.id, companyId: r.p.companyId, code: r.p.code, title: r.p.title, status: r.p.status, version: r.v.version, versionStatus: r.v.status, source, snippet });
        }
        return c.json(out);
      })

      /* ---------- Zeptej se dokumentace (ADR-028) ---------- */
      .post("/qa", requirePerm(...ANY), zValidator("json", DocQaInput), async (c) => {
        const { question } = c.req.valid("json");
        const user = currentUser(c);
        try {
          const r = await askDocs(db, config, {
            question,
            companyIds: scopeOf(c).accessible,
            // jen platné dokumenty, které uživatel smí číst (pravidla portálu, správce dokumentace vše)
            visible: docVisibility(db, c),
          });
          await audit(db, { c, user, action: "policy.qa_asked", details: { question: question.slice(0, 300), sources: r.sources.map((x) => x.policyId), mode: r.mode, ms: r.durationMs } });
          return c.json(r);
        } catch (e) {
          throw new HTTPException(503, { message: (e as Error).message });
        }
      })
      .get("/qa/status", requirePerm(...ANY), async (c) => {
        const s = await getAiSettings(db);
        return c.json({ enabled: s.enabled && s.docQaEnabled });
      })
      .get("/qa/index", requirePerm("policies:read"), async (c) => c.json(await indexStatus(db, scopeOf(c).ids)))
      .post("/qa/reindex", requirePerm("admin:settings"), async (c) => {
        // celé přeindexování na pozadí (např. po změně embedding modelu)
        void processDocIndex(db, config, 30 * 60_000, undefined, true).catch((e) => console.error("Indexace:", (e as Error).message));
        await audit(db, { c, user: currentUser(c), action: "policy.qa_reindex" });
        return c.json(await indexStatus(db, scopeOf(c).ids), 202);
      })

      .get("/mine", requirePerm("obligations:self"), async (c) => c.json(await mine(currentUser(c).id)))

      /** Dokumenty, u kterých má uživatel roli ve schvalování (gestor / vlastník procesu / schvalovatel). */
      .get("/my-roles", requirePerm(...ANY), async (c) => {
        const pos = [...(await myPositions(db, currentUser(c).id))];
        if (!pos.length) return c.json([]);
        const list = await loadPolicies(db, and(inScope(c, policies.companyId), or(inArray(policies.ownerPositionId, pos), inArray(policies.reviewerPositionId, pos), inArray(policies.approverPositionId, pos))));
        return c.json(list.map((x) => x.item));
      })

      /* ---------- portál pro zaměstnance ---------- */
      .get("/portal", requirePerm(...ANY), async (c) => {
        const q = c.req.query("q")?.trim();
        const where = and(
          eq(policies.status, "active"),
          inArray(policies.companyId, scopeOf(c).accessible.length ? scopeOf(c).accessible : ["00000000-0000-0000-0000-000000000000"]),
          q
            ? or(
                ilike(policies.title, `%${likeEsc(q)}%`),
                ilike(policies.code, `%${likeEsc(q)}%`),
                ilike(policies.description, `%${likeEsc(q)}%`),
                sql`exists (select 1 from policy_versions v where v.policy_id = ${policies.id} and v.status = 'approved' and v.content ilike ${`%${likeEsc(q)}%`})`,
                sql`exists (select 1 from policy_versions v join policy_files f on f.version_id = v.id where v.policy_id = ${policies.id} and v.status = 'approved' and f.superseded_at is null and f.search_text like ${`%${likeEsc(normalizeSearch(q))}%`})`,
              )
            : undefined,
        );
        const list = await loadPolicies(db, where);
        const fileMap = await filesOf(db, list.flatMap((x) => (x.current ? [x.current.v.id] : [])));
        const state = await portalState(currentUser(c).id, list);
        const out: PortalDocItem[] = [];
        for (const x of list) {
          const it = await portalItem(c, x, fileMap, state);
          if (!it) continue;
          if (q && x.current) it.snippet = await snippetOf(x.current.v.id, x.current.v.content, q);
          out.push(it);
        }
        out.sort((a, b) => Number(!!a.acknowledgedAt || !a.mustAcknowledge) - Number(!!b.acknowledgedAt || !b.mustAcknowledge) || a.title.localeCompare(b.title, "cs"));
        return c.json(out);
      })
      .get("/portal/:id", requirePerm(...ANY), async (c) => {
        const { x, item } = await portalDoc(c, c.req.param("id"));
        const user = currentUser(c);
        const d: PortalDocDetail = {
          ...item,
          content: x.current!.v.content,
          quizPassPct: x.row.quizPassPct,
          quiz: await quizOf(db, x.row.id, false),
          myComments: await commentsOf(db, and(eq(policyComments.policyId, x.row.id), eq(policyComments.userId, user.id))!, user.id),
          history: x.versions
            .filter((v) => v.v.status === "approved" || v.v.status === "superseded")
            .map((v) => ({ version: v.v.version, approvedAt: v.v.approvedAt?.toISOString() ?? null, changeSummary: v.v.changeSummary })),
          previousVersion: previousOf(x)?.v.version ?? null,
        };
        return c.json(d);
      })
      /** Co se změnilo oproti předchozí platné verzi (pro zaměstnance před potvrzením seznámení). */
      .get("/portal/:id/changes", requirePerm(...ANY), async (c) => {
        const { x } = await portalDoc(c, c.req.param("id"));
        const prev = previousOf(x);
        if (!prev) throw new HTTPException(409, { message: "Dokument nemá předchozí verzi." });
        return c.json(await diffVersions(x.row.id, prev.v.id, x.current!.v.id));
      })
      .post("/portal/:id/comments", requirePerm(...ANY), zValidator("json", PolicyCommentInput), async (c) => {
        const { x } = await portalDoc(c, c.req.param("id"));
        const input = c.req.valid("json");
        const user = currentUser(c);
        await db.insert(policyComments).values({ policyId: x.row.id, versionId: x.current!.v.id, userId: user.id, text: input.text, reference: input.reference ?? null });
        await audit(db, { c, user, action: "policy.comment_added", entityType: "policy", entityId: x.row.id, details: { version: x.current!.v.version } });
        return c.json(await commentsOf(db, and(eq(policyComments.policyId, x.row.id), eq(policyComments.userId, user.id))!, user.id), 201);
      })
      .post("/portal/:id/quiz", requirePerm(...ANY), zValidator("json", QuizAnswersInput), async (c) => {
        const { x } = await portalDoc(c, c.req.param("id"));
        const qs = await db.select().from(policyQuizQuestions).where(eq(policyQuizQuestions.policyId, x.row.id)).orderBy(asc(policyQuizQuestions.position));
        if (!qs.length) throw new HTTPException(409, { message: "Dokument nemá test." });
        const { answers } = c.req.valid("json");
        const r = scoreQuiz(qs, answers);
        const passed = r.score >= x.row.quizPassPct;
        const user = currentUser(c);
        await db.insert(policyQuizAttempts).values({ versionId: x.current!.v.id, userId: user.id, score: r.score, passed, answers });
        await audit(db, { c, user, action: "policy.quiz_attempt", entityType: "policy", entityId: x.row.id, details: { version: x.current!.v.version, score: r.score, passed } });
        return c.json({ score: r.score, passed, correct: r.correct, total: qs.length, passPct: x.row.quizPassPct });
      })

      /* ---------- složky, šablony, skartace (dms.ts) ---------- */
      .route("/", dmsRoutes(db))

      /* ---------- správa dokumentu ---------- */
      .post("/", requirePerm("policies:write"), zValidator("json", PolicyInput), async (c) => {
        const { controlIds, parentId, relatedIds, requirementIds, processIds, assetIds, riskIds, supplierIds, companyId: requested, ...input } = c.req.valid("json");
        const companyId = targetCompany(c, requested, "policies:write");
        await checkFolder(input.folderId, companyId);
        await checkPositions(companyId, [input.ownerPositionId, input.reviewerPositionId, input.approverPositionId]);
        const code = input.code?.trim() || (await autoCode(companyId, input.docType ?? "directive", input.folderId));
        const [p] = await db.insert(policies).values({ ...input, code, companyId, retiredAt: input.status === "retired" ? today() : null }).returning();
        await setControls(p!.id, controlIds, companyId);
        await setLinks(p!.id, companyId, { parentId, relatedIds, requirementIds, processIds, assetIds, riskIds, supplierIds });
        await audit(db, { c, user: currentUser(c), action: "policy.created", entityType: "policy", entityId: p!.id, details: { title: p!.title } });
        return c.json(await detail(c, p!.id), 201);
      })
      .get("/:id", requirePerm(...ANY), async (c) => {
        await managed(c, c.req.param("id"));
        return c.json(await detail(c, c.req.param("id")));
      })
      .patch("/:id", requirePerm(...ANY), zValidator("json", PolicyPatch), async (c) => {
        const id = c.req.param("id");
        const { p, a } = await managed(c, id);
        needEditor(a, p);
        const { controlIds, parentId, relatedIds, requirementIds, processIds, assetIds, riskIds, supplierIds, ...rest } = c.req.valid("json");
        const links = { parentId, relatedIds, requirementIds, processIds, assetIds, riskIds, supplierIds };
        const input = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Partial<PolicyRow>;
        // role ve workflow, okruh dotčených osob, zařazení a skartační režim mění jen správce dokumentace (ne sám gestor)
        if (!hasPerm(c, "policies:write"))
          for (const k of ["ownerPositionId", "reviewerPositionId", "approverPositionId", "audience", "status", "classification", "system", "folderId", "retentionYears", "retentionMark"] as const) delete input[k];
        if (input.folderId !== undefined) await checkFolder(input.folderId, p.companyId);
        await checkPositions(p.companyId, [input.ownerPositionId, input.reviewerPositionId, input.approverPositionId]);
        // spouštěcí událost skartační lhůty = zrušení dokumentu
        if (input.status && input.status !== p.status) input.retiredAt = input.status === "retired" ? today() : null;
        if (Object.keys(input).length) await db.update(policies).set({ ...input, updatedAt: new Date() }).where(eq(policies.id, id));
        // vazby mění správce dokumentace i gestor (věcný obsah dokumentu); opatření jen správce
        if (hasPerm(c, "policies:write")) await setControls(id, controlIds, p.companyId);
        await setLinks(id, p.companyId, links);
        const changed = Object.fromEntries(Object.entries(links).filter(([, v]) => v !== undefined));
        await audit(db, { c, user: currentUser(c), action: "policy.updated", entityType: "policy", entityId: id, details: { ...input, controlIds, ...changed } });
        return c.json(await detail(c, id));
      })
      .delete("/:id", requirePerm("policies:write"), async (c) => {
        const id = c.req.param("id");
        const p = await row(c, id);
        if (p.disposedAt) throw new HTTPException(409, { message: "Záznam o skartovaném dokumentu se uchovává jako doklad." });
        const [approved] = await db.select({ id: policyVersions.id }).from(policyVersions).where(and(eq(policyVersions.policyId, id), inArray(policyVersions.status, ["approved", "superseded"])));
        if (approved) throw new HTTPException(409, { message: "Dokument se schválenou verzí nelze smazat – zrušte jeho platnost (stav Zrušený)." });
        await db.delete(policies).where(eq(policies.id, id));
        await audit(db, { c, user: currentUser(c), action: "policy.deleted", entityType: "policy", entityId: id, details: { title: p.title } });
        return c.body(null, 204);
      })

      /* ---------- přezkum bez změny (§ 6 odst. 3) ---------- */
      .post("/:id/review", requirePerm(...ANY), zValidator("json", PolicyReviewInput), async (c) => {
        const id = c.req.param("id");
        const { p, a } = await managed(c, id);
        needEditor(a, p);
        const { note, reviewedAt } = c.req.valid("json");
        await db.update(policies).set({ lastReviewedAt: reviewedAt ?? today(), lastReviewNote: note ?? null, updatedAt: new Date() }).where(eq(policies.id, id));
        await audit(db, { c, user: currentUser(c), action: "policy.reviewed", entityType: "policy", entityId: id, details: { note } });
        return c.json(await detail(c, id));
      })

      /* ---------- test porozumění ---------- */
      .put("/:id/quiz", requirePerm(...ANY), zValidator("json", QuizInput), async (c) => {
        const id = c.req.param("id");
        const { a } = await managed(c, id);
        needEditor(a);
        const qs = c.req.valid("json");
        await db.transaction(async (tx) => {
          await tx.delete(policyQuizQuestions).where(eq(policyQuizQuestions.policyId, id));
          if (qs.length) await tx.insert(policyQuizQuestions).values(qs.map((q, i) => ({ policyId: id, position: i, question: q.question, options: q.options, correct: [...new Set(q.correct)] })));
        });
        await audit(db, { c, user: currentUser(c), action: "policy.quiz_updated", entityType: "policy", entityId: id, details: { questions: qs.length } });
        return c.json(await detail(c, id));
      })

      /* ---------- připomínky ---------- */
      .post("/:id/comments/:cid/resolve", requirePerm(...ANY), zValidator("json", PolicyCommentResolveInput), async (c) => {
        const { id, cid } = c.req.param();
        const { a } = await managed(c, id);
        needEditor(a);
        const input = c.req.valid("json");
        const [r] = await db
          .update(policyComments)
          .set({ status: input.status, response: input.response, respondedById: currentUser(c).id, respondedAt: new Date() })
          .where(and(eq(policyComments.id, cid), eq(policyComments.policyId, id)))
          .returning({ id: policyComments.id });
        if (!r) throw new HTTPException(404, { message: "Připomínka nenalezena" });
        await audit(db, { c, user: currentUser(c), action: "policy.comment_resolved", entityType: "policy", entityId: id, details: { status: input.status } });
        return c.json(await detail(c, id));
      })

      /* ---------- verze ---------- */
      .post("/:id/versions", requirePerm(...ANY), zValidator("json", PolicyVersionInput), async (c) => {
        const id = c.req.param("id");
        const { p, a } = await managed(c, id);
        needEditor(a, p);
        const input = c.req.valid("json");
        const [dup] = await db.select({ id: policyVersions.id }).from(policyVersions).where(and(eq(policyVersions.policyId, id), eq(policyVersions.version, input.version)));
        if (dup) throw new ApiError(409, "err.policies.versionExists", { version: String(input.version) });
        const [open] = await db.select({ id: policyVersions.id }).from(policyVersions).where(and(eq(policyVersions.policyId, id), inArray(policyVersions.status, ["draft", "review", "approval"])));
        if (open) throw new HTTPException(409, { message: "Dokument už má rozpracovanou verzi (návrh nebo v oběhu)." });
        const [v] = await db.insert(policyVersions).values({ ...input, policyId: id, createdById: currentUser(c).id }).returning();
        await audit(db, { c, user: currentUser(c), action: "policy.version_created", entityType: "policy", entityId: id, details: { version: v!.version } });
        return c.json(await detail(c, id), 201);
      })
      .patch("/:id/versions/:vid", requirePerm(...ANY), zValidator("json", PolicyVersionInput.partial()), async (c) => {
        const { id, vid } = c.req.param();
        const { p, a } = await managed(c, id);
        needEditor(a, p);
        await draftFor(c, id, vid);
        const input = Object.fromEntries(Object.entries(c.req.valid("json")).filter(([, v]) => v !== undefined));
        const [v] = await db
          .update(policyVersions)
          .set({ ...input, updatedAt: new Date() })
          .where(and(eq(policyVersions.id, vid), eq(policyVersions.policyId, id), eq(policyVersions.status, "draft")))
          .returning();
        if (!v) throw new HTTPException(409, { message: "Upravit lze jen návrh verze." });
        await audit(db, { c, user: currentUser(c), action: "policy.version_updated", entityType: "policy", entityId: id, details: { version: v.version, fields: Object.keys(input) } });
        return c.json(await detail(c, id));
      })
      .delete("/:id/versions/:vid", requirePerm(...ANY), async (c) => {
        const { id, vid } = c.req.param();
        const { p, a } = await managed(c, id);
        needEditor(a, p);
        await draftFor(c, id, vid);
        const [v] = await db
          .delete(policyVersions)
          .where(and(eq(policyVersions.id, vid), eq(policyVersions.policyId, id), eq(policyVersions.status, "draft")))
          .returning({ version: policyVersions.version });
        if (!v) throw new HTTPException(409, { message: "Smazat lze jen návrh verze – schválené verze se uchovávají." });
        await audit(db, { c, user: currentUser(c), action: "policy.version_deleted", entityType: "policy", entityId: id, details: { version: v.version } });
        return c.json(await detail(c, id));
      })

      /** Soubory verze (originál Word / PDF) – jen v návrhu. */
      .post("/:id/versions/:vid/files", requirePerm(...ANY), async (c) => {
        const { id, vid } = c.req.param();
        const { p, a } = await managed(c, id);
        needEditor(a, p);
        const v = await draftFor(c, id, vid);
        const { upload, field } = await readUpload(c);
        if (!upload) throw new HTTPException(400, { message: "Vyberte soubor" });
        const f = await storeFile(c, v, upload, field("replaceId"), field("note"));
        await audit(db, { c, user: currentUser(c), action: "policy.file_uploaded", entityType: "policy", entityId: id, details: { version: v.version, filename: f.filename, revision: f.revision } });
        return c.json(await detail(c, id), 201);
      })
      .delete("/:id/versions/:vid/files/:fid", requirePerm(...ANY), async (c) => {
        const { id, vid, fid } = c.req.param();
        const { p, a } = await managed(c, id);
        needEditor(a, p);
        const v = await draftFor(c, id, vid);
        // smaže aktuální revizi i její starší revize (návrh – nic z toho nebylo schváleno)
        const all = await db.select({ id: policyFiles.id, replacesId: policyFiles.replacesId }).from(policyFiles).where(eq(policyFiles.versionId, vid));
        const chain = new Set<string>();
        for (let cur: string | null | undefined = fid; cur && !chain.has(cur); cur = all.find((x) => x.id === cur)?.replacesId) chain.add(cur);
        if (!all.some((x) => x.id === fid)) throw new HTTPException(404, { message: "Soubor nenalezen" });
        await db.delete(policyFiles).where(and(inArray(policyFiles.id, [...chain]), eq(policyFiles.versionId, vid)));
        await audit(db, { c, user: currentUser(c), action: "policy.file_deleted", entityType: "policy", entityId: id, details: { version: v.version, files: chain.size } });
        return c.json(await detail(c, id));
      })
      .get("/:id/versions/:vid/files/:fid", requirePerm(...ANY), async (c) => {
        const { id, vid, fid } = c.req.param();
        const { f } = await fileAccess(c, id, vid, fid);
        return sendFile(c, f, c.req.query("inline") === "1");
      })
      /** PDF pro čtení a tisk s doložkou (stav verze, schválení, neřízená kopie) a vodoznakem u návrhu / neplatné verze. */
      .get("/:id/versions/:vid/files/:fid/pdf", requirePerm(...ANY), async (c) => {
        const { id, vid, fid } = c.req.param();
        const { p, v, f } = await fileAccess(c, id, vid, fid);
        const src = f.pdfStatus === "native" || fileKind(f.filename, f.mime, f.content.subarray(0, 4)) === "pdf" ? f.content : f.pdfStatus === "ok" ? f.pdf : null;
        if (!src) throw new HTTPException(404, { message: f.pdfStatus === "failed" ? `Převod do PDF se nezdařil: ${f.pdfError ?? ""}` : "PDF zatím není k dispozici." });
        const { bytes, stamped } = await stampPdf(new Uint8Array(src), await stampFor(c, p, v));
        await audit(db, { c, user: currentUser(c), action: "policy.pdf_viewed", entityType: "policy_file", entityId: f.id, details: { filename: f.filename, version: v.version, stamped } });
        const name = `${f.filename.replace(/\.[^.]+$/, "")}.pdf`;
        return new Response(bytes, {
          headers: {
            "content-type": "application/pdf",
            "content-disposition": `${c.req.query("download") === "1" ? "attachment" : "inline"}; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
            "x-content-type-options": "nosniff",
            "x-contix-stamped": stamped ? "1" : "0",
            "cache-control": "private, no-store",
          },
        });
      })
      /** Znovu převést soubor (po chybě nebo po doplnění písem do převodní služby). */
      .post("/:id/versions/:vid/files/:fid/convert", requirePerm(...ANY), async (c) => {
        const { id, vid, fid } = c.req.param();
        const { p, a } = await managed(c, id);
        if (!a.editor && !hasPermIn(c, "policies:write", p.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        if (!converterEnabled()) throw new HTTPException(409, { message: "Převodní služba není nastavena (CONVERTER_URL)." });
        await versionRow(id, vid);
        const [f] = await db.update(policyFiles).set({ pdfStatus: "pending", pdfError: null }).where(and(eq(policyFiles.id, fid), eq(policyFiles.versionId, vid))).returning({ id: policyFiles.id });
        if (!f) throw new HTTPException(404, { message: "Soubor nenalezen" });
        await processFile(db, f.id);
        return c.json(await detail(c, id));
      })
      /** Porovnání textu dvou verzí (výchozí: s předchozí verzí). */
      .get("/:id/versions/:vid/diff", requirePerm(...ANY), async (c) => {
        const { id, vid } = c.req.param();
        await managed(c, id);
        let base = c.req.query("base");
        if (!base) {
          const vs = await db.select({ id: policyVersions.id }).from(policyVersions).where(eq(policyVersions.policyId, id)).orderBy(asc(policyVersions.createdAt));
          const i = vs.findIndex((x) => x.id === vid);
          base = i > 0 ? vs[i - 1]!.id : undefined;
        }
        if (!base) throw new HTTPException(409, { message: "Není s čím porovnat – jde o první verzi." });
        return c.json(await diffVersions(id, base, vid));
      })

      /* ---------- úprava v desktopovém Office (WebDAV, ADR-026) ---------- */
      /** Odkaz ms-word:ofe|u|… – úprava návrhu (automaticky rezervuje verzi) nebo jen čtení. */
      .post("/:id/versions/:vid/files/:fid/office", requirePerm(...ANY), zValidator("json", OfficeOpenInput), async (c) => {
        const { id, vid, fid } = c.req.param();
        const { mode } = c.req.valid("json");
        const user = currentUser(c);
        const { p, v, f } = await fileAccess(c, id, vid, fid);
        const app = officeAppOf(f.filename);
        if (!app) throw new HTTPException(400, { message: "Soubor nelze otevřít v Office (podporován Word, Excel, PowerPoint)." });
        if (f.supersededAt) throw new HTTPException(409, { message: "Jde o starší revizi – otevřete aktuální soubor." });
        if (mode === "edit") {
          const { a } = await managed(c, id);
          needEditor(a, p);
          const draft = await draftFor(c, id, vid);
          if (!draft.lockedById) {
            const [r] = await db
              .update(policyVersions)
              .set({ lockedById: user.id, lockedAt: new Date() })
              .where(and(eq(policyVersions.id, vid), isNull(policyVersions.lockedById), eq(policyVersions.status, "draft")))
              .returning({ id: policyVersions.id });
            if (!r) throw new HTTPException(409, { message: "Verzi si mezitím rezervoval někdo jiný." });
            await event(vid, "checkout", "draft", "draft", user.id, `Úprava v aplikaci ${app === "word" ? "Word" : app === "excel" ? "Excel" : "PowerPoint"}`);
          }
        }
        const { token, expiresAt } = await createOfficeSession(db, { policyId: p.id, versionId: v.id, fileId: f.id, userId: user.id, mode });
        const url = `${config.APP_URL.replace(/\/+$/, "")}/dav/${token}/${encodeURIComponent(f.filename)}`;
        await audit(db, { c, user, action: mode === "edit" ? "policy.office_edit" : "policy.office_view", entityType: "policy", entityId: p.id, details: { version: v.version, filename: f.filename } });
        const out: OfficeOpenDto = { uri: officeUri(app, mode, url), url, app, mode, expiresAt: expiresAt.toISOString() };
        return c.json(out);
      })

      /* ---------- check-out / check-in (rezervace návrhu k úpravě) ---------- */
      .post("/:id/versions/:vid/checkout", requirePerm(...ANY), async (c) => {
        const { id, vid } = c.req.param();
        const { p, a } = await managed(c, id);
        needEditor(a, p);
        const v = await draftFor(c, id, vid);
        const user = currentUser(c);
        if (!v.lockedById) {
          // podmíněný update – dva současné požadavky nezískají rezervaci oba
          const [r] = await db
            .update(policyVersions)
            .set({ lockedById: user.id, lockedAt: new Date() })
            .where(and(eq(policyVersions.id, vid), isNull(policyVersions.lockedById), eq(policyVersions.status, "draft")))
            .returning({ id: policyVersions.id });
          if (!r) throw new HTTPException(409, { message: "Verzi si mezitím rezervoval někdo jiný." });
          await event(vid, "checkout", "draft", "draft", user.id);
          await audit(db, { c, user, action: "policy.checkout", entityType: "policy", entityId: id, details: { version: v.version } });
        }
        return c.json(await detail(c, id));
      })
      .post("/:id/versions/:vid/checkin", requirePerm(...ANY), async (c) => {
        const { id, vid } = c.req.param();
        const { p, a } = await managed(c, id);
        needEditor(a, p);
        const v = await draftFor(c, id, vid);
        const user = currentUser(c);
        if (v.lockedById !== user.id) throw new HTTPException(409, { message: "Verzi nemáte rezervovanou." });
        const { upload, field } = await readUpload(c);
        const note = CheckinInput.parse({ note: field("note") }).note ?? null;
        let detailNote = note;
        if (upload) {
          const f = await storeFile(c, v, upload, field("replaceId"), note);
          detailNote = `${f.filename} (rev. ${f.revision})${note ? ` – ${note}` : ""}`;
        }
        await db.update(policyVersions).set({ lockedById: null, lockedAt: null, updatedAt: new Date() }).where(eq(policyVersions.id, vid));
        await closeOfficeSessions(db, vid);
        await event(vid, "checkin", "draft", "draft", user.id, detailNote);
        await audit(db, { c, user, action: "policy.checkin", entityType: "policy", entityId: id, details: { version: v.version, file: !!upload } });
        return c.json(await detail(c, id));
      })
      .post("/:id/versions/:vid/unlock", requirePerm(...ANY), async (c) => {
        const { id, vid } = c.req.param();
        const { p } = await managed(c, id);
        const v = await versionRow(id, vid);
        const user = currentUser(c);
        if (!v.lockedById) return c.json(await detail(c, id));
        if (v.lockedById !== user.id && !hasPermIn(c, "policies:write", p.companyId))
          throw new HTTPException(403, { message: "Cizí rezervaci může zrušit jen správce dokumentace." });
        await db.update(policyVersions).set({ lockedById: null, lockedAt: null }).where(eq(policyVersions.id, vid));
        await closeOfficeSessions(db, vid);
        const [u] = await db.select({ n: users.displayName }).from(users).where(eq(users.id, v.lockedById));
        await event(vid, "unlock", v.status, v.status, user.id, v.lockedById === user.id ? null : `Zrušena rezervace uživatele ${u?.n ?? "?"}`);
        await audit(db, { c, user, action: "policy.unlock", entityType: "policy", entityId: id, details: { version: v.version, lockedBy: v.lockedById } });
        return c.json(await detail(c, id));
      })

      /** Soubor verze ze šablony Wordu – doplní značky {{kod}}, {{nazev}}… */
      .post("/:id/versions/:vid/from-template", requirePerm(...ANY), zValidator("json", FromTemplateInput), async (c) => {
        const { id, vid } = c.req.param();
        const { p, a } = await managed(c, id);
        needEditor(a, p);
        const v = await draftFor(c, id, vid);
        const [t] = await db.select().from(policyTemplates).where(eq(policyTemplates.id, c.req.valid("json").templateId));
        if (!t || !scopeOf(c).accessible.includes(t.companyId)) throw new HTTPException(404, { message: "Šablona nenalezena" });
        const pos = await db.select({ id: positions.id, name: positions.name }).from(positions).where(inArray(positions.id, [p.ownerPositionId, p.reviewerPositionId, p.approverPositionId].filter((x): x is string => !!x).concat(["00000000-0000-0000-0000-000000000000"])));
        const posName = (pid: string | null) => pos.find((x) => x.id === pid)?.name ?? "";
        const [co] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, p.companyId));
        const values: Record<keyof typeof TEMPLATE_PLACEHOLDERS, string> = {
          kod: p.code ?? "",
          nazev: p.title,
          druh: POLICY_LABELS.type[p.docType],
          verze: v.version,
          gestor: posName(p.ownerPositionId),
          vlastnik: posName(p.reviewerPositionId),
          schvalovatel: posName(p.approverPositionId),
          klasifikace: POLICY_LABELS.classification[p.classification],
          spolecnost: co?.name ?? "",
          datum: new Date().toLocaleDateString("cs-CZ"),
        };
        const word = isWordTemplate(t.content);
        const filled = word ? fillWordTemplate(t.content, values) : { content: new Uint8Array(t.content), mime: mimeFor(t.filename) };
        const ext = word ? ".docx" : (t.filename.match(/\.[\w]{1,6}$/)?.[0] ?? "");
        const base = `${p.code ? `${p.code} ` : ""}${p.title} v${v.version}`.replace(/[\\/:*?"<>|]+/g, " ").slice(0, 200);
        const f = await storeFile(c, v, { name: `${base}${ext}`, mime: filled.mime, buf: filled.content }, null, `Ze šablony „${t.name}“`);
        await event(vid, "template", "draft", "draft", currentUser(c).id, `${t.name} → ${f.filename}`);
        await audit(db, { c, user: currentUser(c), action: "policy.file_from_template", entityType: "policy", entityId: id, details: { version: v.version, template: t.name } });
        return c.json(await detail(c, id), 201);
      })

      /* ---------- skartace a archivace ---------- */
      /** Balíček dokumentu (ZIP: všechny verze se soubory, texty, historie a seznámení) – před předáním do archivu / skartací. */
      .get("/:id/package", requirePerm("policies:read"), async (c) => {
        const id = c.req.param("id");
        const d = await detail(c, id);
        const files = await db
          .select({ f: policyFiles, version: policyVersions.version, content: policyVersions.content })
          .from(policyFiles)
          .innerJoin(policyVersions, eq(policyVersions.id, policyFiles.versionId))
          .where(eq(policyVersions.policyId, id));
        const texts = await db.select({ version: policyVersions.version, content: policyVersions.content }).from(policyVersions).where(eq(policyVersions.policyId, id));
        const z: Zippable = {};
        const dir = (ver: string) => `verze-${ver.replace(/[^\w.-]+/g, "_")}`;
        for (const { f, version } of files) z[`${dir(version)}/${f.supersededAt ? `revize-${f.revision}-` : ""}${f.filename}`] = new Uint8Array(f.content);
        for (const t of texts) if (t.content) z[`${dir(t.version)}/text.md`] = strToU8(t.content);
        const meta = {
          vytvoreno: new Date().toISOString(),
          dokument: { oznaceni: d.code, nazev: d.title, druh: POLICY_LABELS.type[d.docType], stav: POLICY_LABELS.status[d.status], slozka: d.folderPath, klasifikace: d.classification, skartace: d.retention },
          verze: d.versions.map((v) => ({ verze: v.version, stav: v.status, zmena: v.changeSummary, schvaleno: v.approvedAt, schvalil: v.approvedByName, ucinnost: v.effectiveFrom, seznameno: v.acknowledged, soubory: v.files.map((f) => ({ nazev: f.filename, sha256: f.sha256, revize: f.revision })), historie: v.events })),
        };
        z["dokument.json"] = strToU8(JSON.stringify(meta, null, 2));
        const zip = zipSync(z, { level: 6 });
        await audit(db, { c, user: currentUser(c), action: "policy.package_downloaded", entityType: "policy", entityId: id, details: { files: files.length } });
        const name = `${d.code ? `${d.code} ` : ""}${d.title}`.replace(/[^\w\- .]+/g, "_").slice(0, 120);
        return new Response(zip, {
          headers: {
            "content-type": "application/zip",
            "content-disposition": `attachment; filename="${name}.zip"; filename*=UTF-8''${encodeURIComponent(`${d.code ? `${d.code} ` : ""}${d.title}`)}.zip`,
            "cache-control": "private, no-store",
          },
        });
      })
      /** Skartace / předání do archivu po uplynutí lhůty: smaže obsah (soubory, texty), záznam o dokumentu a historie zůstávají. */
      .post("/:id/dispose", requirePerm("policies:write"), zValidator("json", DisposeInput), async (c) => {
        const id = c.req.param("id");
        const p = await row(c, id);
        if (!hasPermIn(c, "policies:write", p.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        const r = retentionFor(p);
        if (r.state === "disposed") throw new HTTPException(409, { message: "Dokument už byl skartován / předán do archivu." });
        if (r.state !== "due") throw new HTTPException(409, { message: r.state === "active" ? "Skartovat lze jen zrušený dokument." : `Skartační lhůta uplyne ${r.dueAt}.` });
        const input = c.req.valid("json");
        if (input.mode === "shredded" && r.mark === "A") throw new HTTPException(400, { message: "Dokument se skartačním znakem A je archiválie – předejte ho do archivu." });
        const user = currentUser(c);
        const vids = (await db.select({ id: policyVersions.id }).from(policyVersions).where(eq(policyVersions.policyId, id))).map((x) => x.id);
        let removed = 0;
        await db.transaction(async (tx) => {
          if (vids.length) {
            removed = (await tx.delete(policyFiles).where(inArray(policyFiles.versionId, vids)).returning({ id: policyFiles.id })).length;
            await tx.update(policyVersions).set({ content: null, lockedById: null, lockedAt: null, updatedAt: new Date() }).where(inArray(policyVersions.id, vids));
          }
          await tx
            .update(policies)
            .set({ disposedAt: new Date(), disposedById: user.id, disposalMode: input.mode, disposalReference: input.reference ?? null, disposalNote: input.note ?? null, updatedAt: new Date() })
            .where(eq(policies.id, id));
        });
        await audit(db, { c, user, action: "policy.disposed", entityType: "policy", entityId: id, details: { mode: input.mode, reference: input.reference, mark: r.mark, files: removed } });
        return c.json(await detail(c, id));
      })

      /** Schvalovací workflow: předložit → věcná kontrola → schválení; vrácení s poznámkou. */
      .post("/:id/versions/:vid/workflow", requirePerm(...ANY), zValidator("json", PolicyWorkflowInput), async (c) => {
        const { id, vid } = c.req.param();
        const { p, a } = await managed(c, id);
        const v = await versionRow(id, vid);
        const { action, note } = c.req.valid("json");
        const user = currentUser(c);
        const files = (await filesOf(db, [vid])).get(vid) ?? [];
        if (action === "submit") {
          if (v.status !== "draft") throw new HTTPException(409, { message: "Předložit lze jen návrh verze." });
          if (!a.editor) throw new HTTPException(403, { message: "Předložit může gestor nebo správce dokumentace." });
          if (p.disposedAt) throw new HTTPException(409, { message: "Dokument byl skartován." });
          await draftFor(c, id, vid);
          if (!v.content && !files.length && !p.location) throw new HTTPException(400, { message: "Nahrajte soubor dokumentu, doplňte text nebo umístění (§ 6 odst. 5 písm. a)." });
          const to: PolicyVersionStatus = p.reviewerPositionId ? "review" : "approval";
          // předložením se rezervace uvolní (verze jde do oběhu)
          await db.update(policyVersions).set({ status: to, submittedAt: new Date(), lockedById: null, lockedAt: null, updatedAt: new Date() }).where(eq(policyVersions.id, vid));
          await closeOfficeSessions(db, vid);
          await event(vid, "submit", "draft", to, user.id, note);
        } else if (action === "review_ok") {
          if (v.status !== "review") throw new HTTPException(409, { message: "Verze není ve věcné kontrole." });
          if (!a.canReview) throw new HTTPException(403, { message: "Věcnou kontrolu provádí vlastník procesu." });
          await db.update(policyVersions).set({ status: "approval", updatedAt: new Date() }).where(eq(policyVersions.id, vid));
          await event(vid, "review_ok", "review", "approval", user.id, note);
        } else if (action === "return") {
          if (v.status !== "review" && v.status !== "approval") throw new HTTPException(409, { message: "Vrátit lze jen verzi v oběhu." });
          if (!(v.status === "review" ? a.canReview : a.canApprove)) throw new HTTPException(403, { message: "Verzi může vrátit jen ten, kdo ji právě kontroluje nebo schvaluje." });
          if (!note?.trim()) throw new HTTPException(400, { message: "Uveďte, co je potřeba přepracovat." });
          await db.update(policyVersions).set({ status: "draft", updatedAt: new Date() }).where(eq(policyVersions.id, vid));
          await event(vid, "return", v.status, "draft", user.id, note);
        } else {
          if (v.status !== "approval") throw new HTTPException(409, { message: "Verze není předložena ke schválení." });
          if (!a.canApprove) throw new HTTPException(403, { message: "Schválit může schvalovatel dokumentu." });
          await approveVersion(c, p, v, "approve", note);
          return c.json(await detail(c, id));
        }
        await audit(db, { c, user, action: `policy.workflow_${action}`, entityType: "policy", entityId: id, details: { version: v.version, note } });
        return c.json(await detail(c, id));
      })

      /** Přímé schválení (správce s „Schvalovat dokumenty ISMS“) – mimo běžný oběh, zapíše se do historie. */
      .post("/:id/versions/:vid/approve", requirePerm("documents:approve"), async (c) => {
        const { id, vid } = c.req.param();
        const p = await row(c, id);
        const v = await versionRow(id, vid);
        if (!["draft", "review", "approval"].includes(v.status)) throw new HTTPException(409, { message: "Schválit lze jen rozpracovanou verzi." });
        if (p.disposedAt) throw new HTTPException(409, { message: "Dokument byl skartován." });
        if (v.status === "draft") await draftFor(c, id, vid);
        const files = (await filesOf(db, [vid])).get(vid) ?? [];
        if (!v.content && !files.length && !p.location) throw new HTTPException(400, { message: "Doplňte text dokumentu, soubor nebo místo, kde je dostupný (§ 6 odst. 5 písm. a)." });
        await approveVersion(c, p, v, "direct_approve");
        return c.json(await detail(c, id));
      })

      /** Text verze – pro správu dokumentu nebo čtenáře platné verze (portál). */
      .get("/:id/versions/:vid/content", requirePerm(...ANY), async (c) => {
        const { id, vid } = c.req.param();
        const [p] = await db.select().from(policies).where(eq(policies.id, id));
        if (!p) throw new HTTPException(404, { message: "Dokument nenalezen" });
        const v = await versionRow(id, vid);
        let ok = false;
        try {
          assertScope(c, p.companyId);
          const a = await accessOf(db, c, p);
          ok = a.manager || a.roleHolder || a.docsApprover;
        } catch {
          ok = false;
        }
        if (!ok) ok = v.status === "approved" && (await portalVisible(db, c, p)).visible;
        if (!ok) throw new HTTPException(404, { message: "Dokument nenalezen" });
        return c.json({ title: p.title, code: p.code, version: v.version, status: v.status, content: v.content, location: p.location, classification: p.classification });
      })

      /** Prokazatelné seznámení s platnou verzí (§ 6 odst. 5 písm. b) – po úspěšném testu, pokud ho dokument má. */
      .post("/:id/versions/:vid/acknowledge", requirePerm("obligations:self"), async (c) => {
        const { id, vid } = c.req.param();
        const user = currentUser(c);
        const [p] = await db.select().from(policies).where(eq(policies.id, id));
        const [v] = await db.select().from(policyVersions).where(and(eq(policyVersions.id, vid), eq(policyVersions.policyId, id)));
        if (!p || !v || v.status !== "approved") throw new HTTPException(404, { message: "Platná verze dokumentu nenalezena" });
        if (!(await audienceMembers(db, p.companyId, p.audience)).some((m) => m.userId === user.id))
          throw new HTTPException(403, { message: "Nejste v okruhu dotčených osob tohoto dokumentu." });
        const [qn] = await db.select({ n: sql<number>`count(*)::int` }).from(policyQuizQuestions).where(eq(policyQuizQuestions.policyId, id));
        let score: number | null = null;
        if (Number(qn?.n ?? 0) > 0) {
          const [best] = await db
            .select({ score: policyQuizAttempts.score })
            .from(policyQuizAttempts)
            .where(and(eq(policyQuizAttempts.versionId, vid), eq(policyQuizAttempts.userId, user.id), eq(policyQuizAttempts.passed, true)))
            .orderBy(desc(policyQuizAttempts.score))
            .limit(1);
          if (!best) throw new HTTPException(409, { message: "Před potvrzením seznámení úspěšně absolvujte test porozumění." });
          score = best.score;
        }
        await recordAcknowledgement(c, p, v, score);
        return c.json(await mine(user.id));
      })
  );
}
