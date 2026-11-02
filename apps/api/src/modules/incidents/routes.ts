import { profileOf, buildIncidentReport,
  IncidentInput,
  IncidentPatch,
  IncidentReportInput,
  INCIDENT_LABELS,
  incidentDeadlines,
  incidentGaps,
  isReportable,
  isSignificant,
  riskScore,
  SIGNIFICANCE_AREAS,
  type IncidentDetail,
  type IncidentListItem,
  type IncidentReportDto,
  type ReportType,
  type Settings,
  type Translate,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, hasPerm, requireModule, requirePerm } from "../../auth/middleware";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import { assertScope, companySettings, getCompanies, hasPermIn, inScope, riskPolicies, scopeOf, settingsFor, targetCompany } from "../../auth/scope";
import { docxResponse, htmlToDocx } from "../documents/docx";
import { printPage } from "../documents/render";
import { socDraftFor, socEvidenceFor } from "../soc/incident";
import { incidentRecordHtml } from "./record";
import type { Db } from "../../db/client";
import { CS_T, tFor } from "../i18n/service";
import {
  assets,
  controls,
  incidentAssets,
  incidentControls,
  incidentProcesses,
  incidentReports,
  incidentRisks,
  incidents,
  incidentSuppliers,
  positionHolders,
  positions,
  processes,
  risks,
  suppliers,
  users,
} from "../../db/schema";

type Ctx = Context<AppEnv>;
type IncidentRow = typeof incidents.$inferSelect;
type ReportRow = typeof incidentReports.$inferSelect;

const LINKS = { assetIds: incidentAssets, processIds: incidentProcesses, riskIds: incidentRisks, controlIds: incidentControls, supplierIds: incidentSuppliers } as const;
type LinkKey = keyof typeof LINKS;

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const nl = (v: unknown) => esc(v).replace(/\n/g, "<br>");
const numLoc = (locale: string) => (locale === "cs" ? "cs-CZ" : locale);
const dtL = (v: Date | string | null | undefined, locale = "cs") => (v ? new Date(v).toLocaleString(numLoc(locale), { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Prague" }) : "—");

function reportDto(r: ReportRow, names: Map<string, string>): IncidentReportDto {
  return {
    id: r.id,
    reportType: r.reportType,
    recipient: r.recipient,
    channel: r.channel,
    submittedAt: r.submittedAt.toISOString(),
    reference: r.reference,
    summary: r.summary,
    createdByName: r.createdById ? (names.get(r.createdById) ?? null) : null,
  };
}

function compute(i: IncidentRow, reports: ReportRow[], s: Settings) {
  const base = { ...i, detectedAt: i.detectedAt.toISOString(), resolvedAt: i.resolvedAt?.toISOString() ?? null };
  const deadlines = incidentDeadlines(
    base,
    reports.map((r) => ({ reportType: r.reportType, submittedAt: r.submittedAt.toISOString() })),
    profileOf(s).incidentRegime,
    { trustService: s.trustServiceProvider, legalRef: profileOf(s).incidentLegalRef },
  );
  const open = deadlines.filter((d) => d.state === "pending" || d.state === "overdue").sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
  return {
    reportable: isReportable(i, profileOf(s).incidentRegime),
    significant: isSignificant(i),
    deadlines,
    nextDeadline: open[0] ?? null,
    overdueReports: deadlines.filter((d) => d.state === "overdue").length,
  };
}

/** Seznam incidentů s lhůtami hlášení (použito i ve snímcích dokumentů). */
export async function loadIncidents(db: Db, where?: SQL) {
  const base = await getSettings(db);
  const all = await getCompanies(db);
  const cache = new Map<string, Settings>();
  // režim a lhůty se řídí nastavením společnosti, které incident patří
  const sOf = (id: string) => cache.get(id) ?? cache.set(id, companySettings(base, all, id)).get(id)!;
  const rows = await db
    .select({ i: incidents, owner: positions.name })
    .from(incidents)
    .leftJoin(positions, eq(positions.id, incidents.ownerPositionId))
    .where(where)
    .orderBy(desc(incidents.detectedAt));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.i.id);
  const [reps, aa] = await Promise.all([
    db.select().from(incidentReports).where(inArray(incidentReports.incidentId, ids)).orderBy(asc(incidentReports.submittedAt)),
    db.select({ incidentId: incidentAssets.incidentId, name: assets.name }).from(incidentAssets).innerJoin(assets, eq(assets.id, incidentAssets.targetId)).where(inArray(incidentAssets.incidentId, ids)),
  ]);
  return rows.map(({ i, owner }) => {
    const r = reps.filter((x) => x.incidentId === i.id);
    const c = compute(i, r, sOf(i.companyId));
    const item: IncidentListItem = {
      id: i.id,
      companyId: i.companyId,
      code: i.code,
      title: i.title,
      kind: i.kind,
      status: i.status,
      category: i.category,
      detectedAt: i.detectedAt.toISOString(),
      resolvedAt: i.resolvedAt?.toISOString() ?? null,
      ownerPositionName: owner,
      reportable: c.reportable,
      significant: c.significant,
      personalDataBreach: i.personalDataBreach,
      nextDeadline: c.nextDeadline,
      overdueReports: c.overdueReports,
      assetCount: aa.filter((x) => x.incidentId === i.id).length,
      assetNames: aa.filter((x) => x.incidentId === i.id).map((x) => x.name).slice(0, 5),
      cause: i.cause,
      updatedAt: i.updatedAt.toISOString(),
    };
    return { ...item, _row: i, _reports: r, _deadlines: c.deadlines };
  });
}

export const incidentPeriod = (from?: string | null, to?: string | null) =>
  and(from ? gte(incidents.detectedAt, new Date(`${from}T00:00:00Z`)) : undefined, to ? lte(incidents.detectedAt, new Date(`${to}T23:59:59Z`)) : undefined);

/** Souhrn za období pro zprávu o hodnocení rizik a přezkoumání ISMS. */
export async function incidentSummary(db: Db, from?: string | null, to?: string | null, companyIds?: string[]) {
  const list = await loadIncidents(db, and(incidentPeriod(from, to), companyIds ? inArray(incidents.companyId, companyIds) : undefined));
  const inc = list.filter((x) => x.kind === "incident");
  const byCategory: Record<string, number> = {};
  for (const x of inc) byCategory[x.category] = (byCategory[x.category] ?? 0) + 1;
  return {
    events: list.filter((x) => x.kind === "event").length,
    unassessed: list.filter((x) => x.kind === "unassessed").length,
    incidents: inc.length,
    significant: inc.filter((x) => x.significant).length,
    reported: inc.filter((x) => x._reports.some((r) => r.reportType === "initial")).length,
    reportable: inc.filter((x) => x.reportable).length,
    overdueReports: inc.reduce((n, x) => n + x.overdueReports, 0),
    personalData: inc.filter((x) => x.personalDataBreach).length,
    byCategory,
    list: inc.map((x) => ({
      code: x.code,
      title: x.title,
      category: x.category,
      detectedAt: x.detectedAt,
      status: x.status,
      significant: x.significant,
      reportable: x.reportable,
      downtimeHours: x._row.downtimeHours,
      rootCause: x._row.rootCause,
      lessonsLearned: x._row.lessonsLearned,
    })),
  };
}
export type IncidentSummary = Awaited<ReturnType<typeof incidentSummary>>;

/** Zvládání událostí a incidentů – § 14 vyhl. č. 409/2025 Sb., hlášení § 15–16 zákona č. 264/2025 Sb. */
export function incidentRoutes(db: Db) {
  async function canEdit(c: Ctx, ownerPositionId: string | null) {
    if (hasPerm(c, "incidents:write")) return true;
    if (!ownerPositionId) return false;
    const rows = await db.select().from(positionHolders).where(eq(positionHolders.positionId, ownerPositionId));
    return rows.some((r) => r.userId === currentUser(c).id);
  }

  async function detail(c: Ctx, id: string): Promise<IncidentDetail> {
    const [item] = await loadIncidents(db, eq(incidents.id, id));
    if (!item) throw new HTTPException(404, { message: "Záznam nenalezen" });
    assertScope(c, item.companyId, "Záznam nenalezen");
    const { _row: r, _reports, _deadlines, ...rest } = item;
    const s = await settingsFor(db, null, r.companyId);
    const policies = await riskPolicies(db, await getSettings(db));
    const userIds = [...new Set([r.createdById, ..._reports.map((x) => x.createdById)].filter((x): x is string => !!x))];
    const [as, ps, rs, cs, ss, names] = await Promise.all([
      db.select({ id: assets.id, name: assets.name, assetType: assets.assetType }).from(incidentAssets).innerJoin(assets, eq(assets.id, incidentAssets.targetId)).where(eq(incidentAssets.incidentId, id)).orderBy(asc(assets.name)),
      db.select({ id: processes.id, code: processes.code, name: processes.name }).from(incidentProcesses).innerJoin(processes, eq(processes.id, incidentProcesses.targetId)).where(eq(incidentProcesses.incidentId, id)),
      db.select({ r: risks }).from(incidentRisks).innerJoin(risks, eq(risks.id, incidentRisks.targetId)).where(eq(incidentRisks.incidentId, id)),
      db.select({ id: controls.id, code: controls.code, name: controls.name }).from(incidentControls).innerJoin(controls, eq(controls.id, incidentControls.targetId)).where(eq(incidentControls.incidentId, id)),
      db.select({ id: suppliers.id, name: suppliers.name, significant: suppliers.significant }).from(incidentSuppliers).innerJoin(suppliers, eq(suppliers.id, incidentSuppliers.targetId)).where(eq(incidentSuppliers.incidentId, id)),
      userIds.length ? db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, userIds)) : [],
    ]);
    const nameMap = new Map(names.map((n) => [n.id, n.name]));
    return {
      ...rest,
      description: r.description,
      cause: r.cause,
      reportedBy: r.reportedBy,
      ownerPositionId: r.ownerPositionId,
      occurredAt: r.occurredAt?.toISOString() ?? null,
      inScope: r.inScope,
      cyberOrigin: r.cyberOrigin,
      intentExcluded: r.intentExcluded,
      toleranceExceeded: r.toleranceExceeded,
      significanceAreas: r.significanceAreas,
      significanceNote: r.significanceNote,
      authorityDecision: r.authorityDecision,
      suspectedUnlawful: r.suspectedUnlawful,
      crossBorder: r.crossBorder,
      affectedUsers: r.affectedUsers,
      downtimeHours: r.downtimeHours,
      financialLoss: r.financialLoss,
      impactDescription: r.impactDescription,
      indicators: r.indicators,
      evidence: r.evidence,
      containment: r.containment,
      rootCause: r.rootCause,
      lessonsLearned: r.lessonsLearned,
      timeline: r.timeline,
      reports: _reports.map((x) => reportDto(x, nameMap)),
      deadlines: _deadlines,
      gaps: incidentGaps({ ...r, significant: rest.significant, reports: _reports }),
      recipient: profileOf(s).incidentRecipient,
      regime: profileOf(s).incidentRegime,
      tolerance: s.incidentTolerance,
      assets: as,
      processes: ps,
      risks: rs.map(({ r: x }) => ({ id: x.id, code: x.code, name: x.name, level: riskScore(policies.get(x.companyId)!, x, x.scaleLevels).level })),
      controls: cs,
      suppliers: ss,
      createdByName: r.createdById ? (nameMap.get(r.createdById) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      canEdit: await canEdit(c, r.ownerPositionId),
    };
  }

  async function setLinks(incidentId: string, v: Partial<Record<LinkKey, string[]>>) {
    for (const key of Object.keys(LINKS) as LinkKey[]) {
      const list = v[key];
      if (!list) continue;
      const t = LINKS[key];
      await db.delete(t).where(eq(t.incidentId, incidentId));
      const ids = [...new Set(list)];
      if (ids.length) await db.insert(t).values(ids.map((targetId) => ({ incidentId, targetId })));
    }
  }

  const toRow = (v: Record<string, unknown>) => {
    const out: Record<string, unknown> = { ...v };
    for (const k of ["detectedAt", "occurredAt", "resolvedAt"]) if (typeof out[k] === "string") out[k] = new Date(out[k] as string);
    if (out.significanceAreas) {
      const keys = new Set<string>(SIGNIFICANCE_AREAS.map((a) => a.key));
      out.significanceAreas = Object.fromEntries(Object.entries(out.significanceAreas as Record<string, boolean>).filter(([k]) => keys.has(k)));
    }
    return out;
  };

  /** Podklad pro hlášení k tisku – obsah z `buildIncidentReport` podle pravidel společnosti (ZKB, NIS2, DORA – ADR-086). */
  function reportHtml(d: IncidentDetail, s: Settings, type: ReportType, t: Translate = CS_T, lei: string | null = null) {
    const dt = (v: Date | string | null | undefined) => dtL(v, t.locale);
    const r = buildIncidentReport(d, s, type, null, t, new Date(), { lei });
    const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${v || `<span class="m">${esc(t("srv.inc.notStated"))}</span>`}</td></tr>`;
    const body = r.sections.map((sec) => `<h2>${esc(sec.title)}</h2><table>${sec.fields.map((x) => row(x.label, nl(x.value))).join("")}</table>`).join("");
    const timeline =
      type === "final" ? `<h2>${esc(t("srv.inc.hTimeline"))}</h2>${d.timeline.length ? `<table>${d.timeline.map((x) => row(dt(x.at), nl(x.text))).join("")}</table>` : `<p class="m">${esc(t("srv.inc.noEntries"))}</p>`}` : "";
    const note = type === "gdpr" ? t("srv.inc.noteGdpr") : d.regime === "dora" ? t("srv.inc.noteDora", { authority: r.recipientName }) : d.regime === "nis2" ? t("srv.inc.noteNis2") : t("srv.inc.noteNukib");
    return `<!doctype html><html lang="${esc(t.locale)}"><head><meta charset="utf-8"><title>${esc(r.title)}</title><style>
body{font:10.5pt/1.45 system-ui,sans-serif;color:#1e293b;max-width:900px;margin:24px auto;padding:0 24px}h1{font-size:17pt;margin:0}h2{font-size:12pt;margin:22px 0 6px;border-bottom:1px solid #e2e8f0}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #e2e8f0;padding:4px 6px;text-align:left;vertical-align:top}th{width:32%;background:#f8fafc;font-weight:600}.m{color:#64748b}.note{background:#fef3c7;border:1px solid #fcd34d;padding:8px 12px;margin:12px 0;font-size:9.5pt}
button{float:right}@media print{button,.note{display:none}}</style></head><body><button onclick="window.print()">${esc(t("srv.inc.print"))}</button>
<h1>${esc(r.title)}</h1><div class="m">${esc(t("srv.inc.generated", { date: dt(new Date()), recipient: r.recipientName }))}</div>
${r.legalBasis ? `<div class="m">${esc(r.legalBasis)}</div>` : ""}
<div class="note">${esc(note)}</div>
${body}${timeline}</body></html>`;
  }

  /** SOC podklady jen se zapnutým modulem a soc:read ve společnosti incidentu. */
  async function socAllowed(c: Ctx, companyId: string) {
    return ((await getSettings(db)).enabledModules as string[]).includes("soc") && hasPermIn(c, "soc:read", companyId);
  }
  async function recordOf(c: Ctx, id: string) {
    const d = await detail(c, id);
    const s = await settingsFor(db, null, d.companyId);
    const ev = (await socAllowed(c, d.companyId)) ? await socEvidenceFor(db, d.id) : null;
    return incidentRecordHtml(d, s, ev, await tFor(db, c));
  }

  /** Předvyplněné hlášení (ADR-067). */
  /** Kód LEI společnosti z údajů DORA (registr informací). */
  async function leiOf(companyId: string) {
    return (await getCompanies(db)).find((x) => x.id === companyId)?.dora?.lei ?? null;
  }
  async function reportDraftOf(c: Ctx, id: string, type: ReportType) {
    const d = await detail(c, id);
    const s = await settingsFor(db, null, d.companyId);
    const ev = (await socAllowed(c, d.companyId)) ? await socEvidenceFor(db, d.id) : null;
    const soc = ev ? { alerts: ev.alerts.length, techniques: ev.techniques, iocs: ev.iocs.map((i) => i.display ?? i.value), firstSeen: ev.firstSeen } : null;
    return buildIncidentReport(d, s, type, soc, await tFor(db, c), new Date(), { lei: await leiOf(d.companyId) });
  }
  const ReportTypeQuery = z.object({ type: z.enum(["initial", "notification", "interim", "final", "voluntary", "gdpr"]) });

  const ListQuery = z.object({ q: z.string().optional(), view: z.enum(["open", "all", "incidents", "reportable"]).optional(), from: z.string().date().optional(), to: z.string().date().optional() });

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "incidents"))
      .get("/", requirePerm("incidents:read"), zValidator("query", ListQuery), async (c) => {
        const { q, view, from, to } = c.req.valid("query");
        const where = and(
          q ? or(ilike(incidents.title, `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`), ilike(incidents.code, `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`)) : undefined,
          view === "open" ? sql`${incidents.status} <> 'closed'` : undefined,
          view === "incidents" || view === "reportable" ? eq(incidents.kind, "incident") : undefined,
          incidentPeriod(from, to),
          inScope(c, incidents.companyId),
        );
        let rows = await loadIncidents(db, where);
        if (view === "reportable") rows = rows.filter((r) => r.reportable || r.personalDataBreach);
        return c.json(rows.map(({ _row, _reports, _deadlines, ...x }) => x));
      })
      .get("/summary", requirePerm("incidents:read"), zValidator("query", z.object({ from: z.string().date().optional(), to: z.string().date().optional() })), async (c) => {
        const { from, to } = c.req.valid("query");
        const { list, ...rest } = await incidentSummary(db, from, to, scopeOf(c).ids);
        return c.json(rest);
      })
      .post("/", zValidator("json", IncidentInput), async (c) => {
        if (!hasPerm(c, "incidents:report") && !hasPerm(c, "incidents:write")) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        // nahlásit událost smí každý se čtením (§ 14 odst. 1 písm. f – oznamování neobvyklého chování); kvalifikaci provádí správce
        const { assetIds, processIds, riskIds, controlIds, supplierIds, companyId: requested, ...input } = c.req.valid("json");
        const admin = hasPerm(c, "incidents:write");
        const companyId = targetCompany(c, requested);
        const values = toRow(admin ? input : { title: input.title, description: input.description, category: input.category, detectedAt: input.detectedAt, occurredAt: input.occurredAt, reportedBy: input.reportedBy ?? currentUser(c).displayName });
        const [row] = await db
          .insert(incidents)
          .values({ ...(values as typeof incidents.$inferInsert), companyId, createdById: currentUser(c).id })
          .returning();
        await setLinks(row!.id, admin ? { assetIds, processIds, riskIds, controlIds, supplierIds } : { assetIds });
        await audit(db, { c, user: currentUser(c), action: "incident.created", entityType: "incident", entityId: row!.id, details: { title: row!.title, kind: row!.kind } });
        if (!hasPerm(c, "incidents:read")) return c.json({ id: row!.id, title: row!.title }, 201);
        return c.json(await detail(c, row!.id), 201);
      })
      .get("/:id", requirePerm("incidents:read"), async (c) => c.json(await detail(c, c.req.param("id"))))
      .patch("/:id", requirePerm("incidents:read"), zValidator("json", IncidentPatch), async (c) => {
        const id = c.req.param("id");
        const [cur] = await db.select().from(incidents).where(eq(incidents.id, id));
        if (!cur) throw new HTTPException(404, { message: "Záznam nenalezen" });
        assertScope(c, cur.companyId, "Záznam nenalezen");
        if (!(await canEdit(c, cur.ownerPositionId))) throw new HTTPException(403, { message: "Incident upravuje odpovědná osoba nebo správce incidentů" });
        const { assetIds, processIds, riskIds, controlIds, supplierIds, ...rest } = c.req.valid("json");
        const input = toRow(Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)));
        if (!hasPerm(c, "incidents:write")) {
          // odpovědná osoba neklasifikuje (incident / událost) ani nemění posouzení povinnosti hlásit
          for (const k of ["kind", "ownerPositionId", "inScope", "cyberOrigin", "intentExcluded", "authorityDecision"]) delete input[k];
        }
        if (input.status === "resolved" && !cur.resolvedAt && !input.resolvedAt) input.resolvedAt = new Date();
        if (Object.keys(input).length) await db.update(incidents).set({ ...input, updatedAt: new Date() }).where(eq(incidents.id, id));
        await setLinks(id, { assetIds, processIds, riskIds, controlIds, supplierIds });
        await audit(db, { c, user: currentUser(c), action: "incident.updated", entityType: "incident", entityId: id, details: { ...rest, timeline: undefined } });
        return c.json(await detail(c, id));
      })
      .delete("/:id", requirePerm("incidents:write"), async (c) => {
        const id = c.req.param("id");
        const [cur] = await db.select({ companyId: incidents.companyId }).from(incidents).where(eq(incidents.id, id));
        assertScope(c, cur?.companyId, "Záznam nenalezen");
        const [row] = await db.delete(incidents).where(eq(incidents.id, id)).returning({ title: incidents.title });
        if (!row) throw new HTTPException(404, { message: "Záznam nenalezen" });
        await audit(db, { c, user: currentUser(c), action: "incident.deleted", entityType: "incident", entityId: id, details: row });
        return c.body(null, 204);
      })
      /** Záznam o podaném hlášení (§ 14 odst. 1 písm. j) a l). */
      .post("/:id/reports", requirePerm("incidents:write"), zValidator("json", IncidentReportInput), async (c) => {
        const id = c.req.param("id");
        const [cur] = await db.select({ id: incidents.id, detectedAt: incidents.detectedAt, companyId: incidents.companyId }).from(incidents).where(eq(incidents.id, id));
        if (!cur) throw new HTTPException(404, { message: "Záznam nenalezen" });
        assertScope(c, cur.companyId, "Záznam nenalezen");
        const input = c.req.valid("json");
        const at = new Date(input.submittedAt);
        if (at.getTime() > Date.now() + 5 * 60_000) throw new HTTPException(400, { message: "Datum podání nemůže být v budoucnosti." });
        if (at < cur.detectedAt) throw new HTTPException(400, { message: "Hlášení nemůže předcházet zjištění incidentu." });
        await db.insert(incidentReports).values({ ...input, submittedAt: at, incidentId: id, createdById: currentUser(c).id });
        await audit(db, { c, user: currentUser(c), action: "incident.reported", entityType: "incident", entityId: id, details: { reportType: input.reportType, recipient: input.recipient } });
        return c.json(await detail(c, id), 201);
      })
      .delete("/:id/reports/:reportId", requirePerm("incidents:write"), async (c) => {
        const { id, reportId } = c.req.param();
        await detail(c, id);
        await db.delete(incidentReports).where(and(eq(incidentReports.id, reportId), eq(incidentReports.incidentId, id)));
        await audit(db, { c, user: currentUser(c), action: "incident.report_deleted", entityType: "incident", entityId: id, details: { reportId } });
        return c.json(await detail(c, id));
      })
      /** Podklady ze SOC k incidentu (ADR-056) – jen se zapnutým modulem SOC a oprávněním soc:read. */
      .get("/:id/soc", requirePerm("incidents:read"), async (c) => {
        const d = await detail(c, c.req.param("id"));
        return c.json((await socAllowed(c, d.companyId)) ? await socEvidenceFor(db, d.id) : null);
      })
      /** Návrh doplnění záznamu ze SOC – nic neukládá, převezme ho člověk do formuláře. */
      .get("/:id/soc-draft", requirePerm("incidents:read"), async (c) => {
        const d = await detail(c, c.req.param("id"));
        if (!(await socAllowed(c, d.companyId))) throw new HTTPException(404, { message: "Podklady SOC nejsou k dispozici" });
        const ev = await socEvidenceFor(db, d.id);
        return c.json(socDraftFor({ occurredAt: d.occurredAt, indicators: d.indicators, evidence: d.evidence, containment: d.containment, timeline: d.timeline, assetIds: d.assets.map((a) => a.id) }, ev, await tFor(db, c)));
      })
      /** Záznam o zvládání incidentu (§ 14 vyhl. 409/2025) – tisk a Word. */
      .get("/:id/record.html", requirePerm("incidents:read"), async (c) => {
        const r = await recordOf(c, c.req.param("id"));
        return c.html(printPage(r.title, r.html, (await tFor(db, c)).locale), 200, { "cache-control": "private, no-store" });
      })
      .get("/:id/record.docx", requirePerm("incidents:read"), async (c) => {
        const r = await recordOf(c, c.req.param("id"));
        await audit(db, { c, user: currentUser(c), action: "incident.record_exported", entityType: "incident", entityId: c.req.param("id"), details: { format: "docx" } });
        return docxResponse(await htmlToDocx(r.html, { title: r.title, headerLine: r.org }), `${r.title}.docx`);
      })
      .get("/:id/report", requirePerm("incidents:read"), zValidator("query", ReportTypeQuery), async (c) => c.json(await reportDraftOf(c, c.req.param("id"), c.req.valid("query").type)))
      .get("/:id/report.txt", requirePerm("incidents:read"), zValidator("query", ReportTypeQuery), async (c) => {
        const r = await reportDraftOf(c, c.req.param("id"), c.req.valid("query").type);
        return c.body(r.text, 200, { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="hlaseni-${r.type}.txt"` });
      })
      .get("/:id/report.html", requirePerm("incidents:read"), zValidator("query", z.object({ type: z.enum(["initial", "notification", "interim", "final", "voluntary", "gdpr"]) })), async (c) => {
        const d = await detail(c, c.req.param("id"));
        const s = await settingsFor(db, null, d.companyId);
        return c.body(reportHtml(d, s, c.req.valid("query").type, await tFor(db, c), await leiOf(d.companyId)), 200, {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
        });
      })
  );
}
