import { TUNING_LABELS, effectiveLevel, SOC_LABELS, SOC_SEVERITIES, socSeverity, attackTactic, FrameworkIdSchema, IDENTITY_LABELS, IDENTITY_RULES, IDENTITY_RULE_INFO, IDENTITY_SEVERITIES, type IdentityRule, CONTROL_LABELS, OBLIGATION_LABELS, type ObligationKind, INCIDENT_LABELS, LABELS, RISK_LABELS, VULN_LABELS, dpiaRequired, AiScreening, AIACT_LABELS, MONITOR_LABELS, SUPPLIER_REPORT_LABELS, classifyAiSystem, isAcceptable, riskScore, type Permission, type RiskLevel } from "@contix/shared";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { riskPolicies } from "../../auth/scope";
import { getSettings } from "../../auth/service";
import type { Db } from "../../db/client";
import {
  assets,
  auditFindings,
  audits,
  controlTests,
  controls,
  dpias,
  evidenceControls,
  incidents,
  alertSuggestions,
  positions,
  processingActivities,
  aiSystems,
  craProducts,
  craFindings,
  soc2Engagements,
  socRuleTunings,
  riskTreatmentActions,
  risks,
  suppliers,
  identityFindings,
  controlMonitors,
  supplierReports,
} from "../../db/schema";
import { loadRequirementRows } from "../controls/routes";
import { effLevelSql } from "../soc/exposure";
import { getNotificationSettings } from "../notifications/service";
import { collectObligations, kindsForModules } from "../notifications/obligations";

/* ============================================================
 * Katalog čtecích nástrojů nad daty CONTIX (ADR-021).
 * Používá je dotaz v přirozeném jazyce (model vybere nástroj a parametry) i MCP server.
 * Nástroje NIKDY nemění data; běží s oprávněními a rozsahem společností uživatele.
 * ============================================================ */

export interface ToolCtx {
  db: Db;
  /** Společnosti v rozsahu dotazu; nástroj z nich použije jen ty, kde má uživatel potřebné oprávnění. */
  companyIds: string[];
  byCompany: Map<string, Set<Permission>>;
  enabledModules: string[];
}

export interface ToolResult {
  columns: string[];
  rows: { cells: (string | number | null)[]; link: string | null }[];
  total: number;
  note?: string;
}

export interface QueryTool {
  name: string;
  title: string;
  description: string;
  module: string | null;
  perm: Permission;
  input: z.ZodObject<z.ZodRawShape>;
  run: (ctx: ToolCtx, args: Record<string, unknown>) => Promise<ToolResult>;
}

const LIMIT = 50;
/** Čtecí oprávnění potřebné pro druh povinnosti (stejně jako /notifications/team). */
const OBLIGATION_NEED: Record<ObligationKind, Permission> = {
  soc_sla: "soc:read",
  vuln_remediation: "assets:read",
  info_assessment: "legislation:read",
  incident_report: "incidents:read",
  risk_action: "risks:read",
  risk_review: "risks:read",
  risk_trigger: "risks:read",
  exercise: "bia:read",
  cert_expiry: "assets:read",
  audit_request: "audits:read",
  finding: "audits:read",
  audit: "audits:read",
  isms_review: "isms:read",
  change: "isms:read",
  policy_review: "policies:read",
  plan_test: "bia:read",
  contract: "suppliers:read",
  assessment_cycle: "risks:read",
  control_test: "controls:read",
  evidence_expiry: "controls:read",
  processing_review: "gdpr:read",
  ai_review: "aiact:read",
  cra_report: "cra:read",
  cra_support: "cra:read",
  policy_ack: "policies:read",
  doc_approval: "policies:read",
  doc_retention: "policies:write",
  access_review: "identity:read",
  legal_review: "legislation:read",
  legal_task: "legislation:read",
  exception_expiry: "assets:read",
  supplier_questionnaire: "suppliers:read",
  supplier_report: "suppliers:read",
  task: "actions:read",
  training: "awareness:read",
};
const today = () => new Date().toISOString().slice(0, 10);
const like = (q: unknown) => `%${String(q).replace(/[%_]/g, (m) => `\\${m}`)}%`;
const out = (columns: string[], rows: ToolResult["rows"], note?: string): ToolResult => ({ columns, rows: rows.slice(0, LIMIT), total: rows.length, ...(note ? { note } : {}) });

const tools: QueryTool[] = [
  {
    name: "assets_search",
    title: "Aktiva",
    description: "Vyhledá aktiva (servery, aplikace, informace…) podle kritičnosti, typu, stavu (semafor zranitelností), chybějícího vlastníka nebo textu.",
    module: "assets",
    perm: "assets:read",
    input: z.object({
      q: z.string().max(100).optional().describe("hledaný text v názvu / hostname"),
      criticality: z.enum(["low", "medium", "high", "critical"]).optional(),
      assetType: z.string().max(40).optional().describe("např. server, workstation, application, information"),
      health: z.enum(["green", "orange", "red", "unknown"]).optional().describe("semafor zranitelností a podpory OS"),
      withoutOwner: z.boolean().optional().describe("jen aktiva bez vlastníka"),
      assetClass: z.enum(["primary", "supporting"]).optional(),
    }),
    async run(ctx, a) {
      const w: (SQL | undefined)[] = [inArray(assets.companyId, ctx.companyIds), ne(assets.lifecycleStatus, "retired")];
      if (a.q) w.push(or(ilike(assets.name, like(a.q)), ilike(assets.hostname, like(a.q))));
      if (a.criticality) w.push(eq(assets.criticality, a.criticality as never));
      if (a.assetType) w.push(eq(assets.assetType, a.assetType as never));
      if (a.health) w.push(eq(assets.healthStatus, a.health as never));
      if (a.assetClass) w.push(eq(assets.assetClass, a.assetClass as never));
      if (a.withoutOwner) w.push(and(isNull(assets.ownerUserId), or(isNull(assets.ownerName), eq(assets.ownerName, ""))));
      const rows = await ctx.db.select().from(assets).where(and(...w)).orderBy(desc(assets.criticality), asc(assets.name)).limit(500);
      return out(
        ["Aktivum", "Typ", "Kritičnost", "Stav", "Vlastník"],
        rows.map((r) => ({
          cells: [r.name, LABELS.assetType[r.assetType as keyof typeof LABELS.assetType] ?? r.assetType, LABELS.criticality[r.criticality as keyof typeof LABELS.criticality] ?? r.criticality, VULN_LABELS.health[r.healthStatus], r.ownerName ?? (r.ownerUserId ? "uživatel" : "—")],
          link: `/assets/${r.id}`,
        })),
      );
    },
  },
  {
    name: "risks_search",
    title: "Rizika",
    description: "Vyhledá rizika podle úrovně, nad hranicí akceptovatelnosti bez ošetření, s akcemi po termínu nebo podle textu.",
    module: "risks",
    perm: "risks:read",
    input: z.object({
      q: z.string().max(100).optional(),
      level: z.enum(["critical", "high", "medium", "low"]).optional().describe("aktuální úroveň rizika"),
      minLevel: z.enum(["critical", "high", "medium", "low"]).optional().describe("tato úroveň a vyšší"),
      unacceptable: z.boolean().optional().describe("jen rizika nad hranicí akceptovatelnosti"),
      untreated: z.boolean().optional().describe("nad hranicí a bez rozhodnutí o zvládání"),
      overdueActions: z.boolean().optional().describe("s akcemi plánu zvládání po termínu"),
    }),
    async run(ctx, a) {
      const pol = await riskPolicies(ctx.db, await getSettings(ctx.db));
      const w: (SQL | undefined)[] = [inArray(risks.companyId, ctx.companyIds), ne(risks.status, "closed")];
      if (a.q) w.push(ilike(risks.name, like(a.q)));
      const rows = await ctx.db.select({ r: risks, owner: positions.name }).from(risks).leftJoin(positions, eq(positions.id, risks.ownerPositionId)).where(and(...w)).limit(1000);
      const ids = rows.map((x) => x.r.id);
      const acts = ids.length ? await ctx.db.select({ riskId: riskTreatmentActions.riskId, due: riskTreatmentActions.dueDate, status: riskTreatmentActions.status }).from(riskTreatmentActions).where(inArray(riskTreatmentActions.riskId, ids)) : [];
      const order: RiskLevel[] = ["low", "medium", "high", "critical"];
      const res = rows
        .map(({ r, owner }) => {
          const p = pol.get(r.companyId)!;
          const s = riskScore(p, r as never, r.scaleLevels);
          const own = acts.filter((x) => x.riskId === r.id);
          const overdue = own.some((x) => x.status !== "done" && x.status !== "cancelled" && x.due && x.due < today());
          const unacc = !!s.level && !isAcceptable(p, s.level, r.methodologyKey);
          return { r, owner, level: s.level, score: s.score, unacc, untreated: unacc && !r.treatment && !own.length && r.status !== "accepted", overdue };
        })
        .filter((x) => (!a.level || x.level === a.level) && (!a.minLevel || (x.level && order.indexOf(x.level) >= order.indexOf(a.minLevel as RiskLevel))) && (!a.unacceptable || x.unacc) && (!a.untreated || x.untreated) && (!a.overdueActions || x.overdue))
        .sort((x, y) => (y.score ?? -1) - (x.score ?? -1));
      return out(
        ["Riziko", "Úroveň", "Ošetření", "Akce po termínu", "Vlastník"],
        res.map((x) => ({
          cells: [`${x.r.code ? `${x.r.code} ` : ""}${x.r.name}`, x.level ? RISK_LABELS.level[x.level] : "nehodnoceno", x.r.treatment ? (RISK_LABELS.treatment[x.r.treatment as keyof typeof RISK_LABELS.treatment] ?? x.r.treatment) : "—", x.overdue ? "ano" : "ne", x.owner ?? "—"],
          link: `/risks/${x.r.id}`,
        })),
      );
    },
  },
  {
    name: "controls_search",
    title: "Opatření",
    description: "Vyhledá bezpečnostní opatření podle stavu zavedení, účinnosti, zda byla testována za 12 měsíců a zda mají důkaz.",
    module: "controls",
    perm: "controls:read",
    input: z.object({
      q: z.string().max(100).optional(),
      status: z.enum(["not_implemented", "planned", "in_progress", "implemented", "not_applicable"]).optional(),
      effectiveness: z.enum(["not_assessed", "effective", "partially_effective", "ineffective"]).optional(),
      untested: z.boolean().optional().describe("bez dokončeného testu za posledních 12 měsíců"),
      withoutEvidence: z.boolean().optional().describe("bez navázaného důkazu"),
    }),
    async run(ctx, a) {
      const w: (SQL | undefined)[] = [inArray(controls.companyId, ctx.companyIds)];
      if (a.q) w.push(or(ilike(controls.name, like(a.q)), ilike(controls.code, like(a.q))));
      if (a.status) w.push(eq(controls.status, a.status as never));
      if (a.effectiveness) w.push(eq(controls.effectiveness, a.effectiveness as never));
      const rows = await ctx.db.select().from(controls).where(and(...w)).orderBy(asc(controls.code)).limit(1000);
      const ids = rows.map((r) => r.id);
      const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
      const [tested, withEv] = ids.length
        ? await Promise.all([
            ctx.db.selectDistinct({ id: controlTests.controlId }).from(controlTests).where(and(inArray(controlTests.controlId, ids), eq(controlTests.status, "completed"), gte(controlTests.performedAt, yearAgo))),
            ctx.db.selectDistinct({ id: evidenceControls.controlId }).from(evidenceControls).where(inArray(evidenceControls.controlId, ids)),
          ])
        : [[], []];
      const t = new Set(tested.map((x) => x.id));
      const e = new Set(withEv.map((x) => x.id));
      const res = rows.filter((r) => (!a.untested || !t.has(r.id)) && (!a.withoutEvidence || !e.has(r.id)));
      return out(
        ["Opatření", "Stav", "Účinnost", "Test 12 m.", "Důkaz"],
        res.map((r) => ({ cells: [`${r.code ? `${r.code} ` : ""}${r.name}`, CONTROL_LABELS.status[r.status], CONTROL_LABELS.effectiveness[r.effectiveness], t.has(r.id) ? "ano" : "ne", e.has(r.id) ? "ano" : "ne"], link: `/controls/${r.id}` })),
      );
    },
  },
  {
    name: "requirements_gaps",
    title: "Požadavky bez shody",
    description: "Požadavky rámce (vyhláška 409/410, ISO 27001, DORA, SOC 2, ZKB) podle míry shody – např. nesplněné nebo neposouzené. Jen pro jednu společnost.",
    module: "controls",
    perm: "controls:read",
    input: z.object({
      framework: FrameworkIdSchema,
      compliance: z.enum(["non_compliant", "partial", "not_assessed", "compliant"]).optional().describe("výchozí: vše kromě splněných"),
      withoutEvidence: z.boolean().optional(),
    }),
    async run(ctx, a) {
      if (ctx.companyIds.length !== 1) return out([], [], "Požadavky se vyhodnocují za jednu společnost – zvolte společnost.");
      const rows = (await loadRequirementRows(ctx.db, ctx.companyIds[0]!, a.framework as never)).filter(
        (r) => r.applicable && (a.compliance ? r.compliance === a.compliance : r.compliance !== "compliant") && (!a.withoutEvidence || !r.evidenceCount),
      );
      return out(
        ["Požadavek", "Text", "Shoda", "Opatření", "Důkazy"],
        rows.map((r) => ({ cells: [r.ref, r.text.slice(0, 160), CONTROL_LABELS.compliance[r.compliance], r.controls.map((c) => c.code ?? c.name).join(", ") || "—", r.evidenceCount], link: `/controls/soa?framework=${a.framework}` })),
      );
    },
  },
  {
    name: "incidents_search",
    title: "Incidenty a události",
    description: "Bezpečnostní události a incidenty – otevřené nebo za období, podle druhu a kategorie.",
    module: "incidents",
    perm: "incidents:read",
    input: z.object({
      open: z.boolean().optional().describe("jen nevyřešené"),
      kind: z.enum(["incident", "event", "unassessed"]).optional(),
      since: z.string().date().optional().describe("zjištěno od data (RRRR-MM-DD)"),
      q: z.string().max(100).optional(),
    }),
    async run(ctx, a) {
      const w: (SQL | undefined)[] = [inArray(incidents.companyId, ctx.companyIds)];
      if (a.open) w.push(inArray(incidents.status, ["new", "assessing", "handling"]));
      if (a.kind) w.push(eq(incidents.kind, a.kind as never));
      if (a.since) w.push(gte(incidents.detectedAt, new Date(String(a.since))));
      if (a.q) w.push(ilike(incidents.title, like(a.q)));
      const rows = await ctx.db.select().from(incidents).where(and(...w)).orderBy(desc(incidents.detectedAt)).limit(500);
      return out(
        ["Událost", "Druh", "Kategorie", "Stav", "Zjištěno"],
        rows.map((r) => ({
          cells: [`${r.code ? `${r.code} ` : ""}${r.title}`, INCIDENT_LABELS.kind[r.kind] ?? r.kind, INCIDENT_LABELS.category[r.category] ?? r.category, INCIDENT_LABELS.status[r.status] ?? r.status, r.detectedAt.toISOString().slice(0, 10)],
          link: `/incidents/${r.id}`,
        })),
      );
    },
  },
  {
    name: "soc_alerts",
    title: "Alerty SOC",
    description: "Fronta bezpečnostních alertů SOC (Wazuh a ruční) – otevřené, nepřevzaté, podle závažnosti nebo taktiky MITRE ATT&CK (ID TA00xx).",
    module: "soc",
    perm: "soc:read",
    input: z.object({
      open: z.boolean().optional().describe("jen otevřené (nové a v řešení)"),
      unassigned: z.boolean().optional().describe("jen nepřevzaté analytikem"),
      severity: z.enum(SOC_SEVERITIES).optional().describe("minimální závažnost"),
      tactic: z.string().regex(/^TA\d{4}$/).optional().describe("taktika ATT&CK, např. TA0006"),
      since: z.string().date().optional().describe("naposledy viděno od data (RRRR-MM-DD)"),
    }),
    async run(ctx, a) {
      const w: (SQL | undefined)[] = [inArray(alertSuggestions.companyId, ctx.companyIds)];
      if (a.open || a.unassigned) w.push(inArray(alertSuggestions.status, ["new", "in_progress"]));
      if (a.unassigned) w.push(isNull(alertSuggestions.assigneeId));
      if (a.severity) w.push(gte(effLevelSql, { low: 0, medium: 7, high: 10, critical: 13 }[a.severity as "low"]));
      if (a.tactic) w.push(sql`${a.tactic} = any(${alertSuggestions.mitreTactics})`);
      if (a.since) w.push(gte(alertSuggestions.lastSeen, new Date(String(a.since))));
      const rows = await ctx.db.select().from(alertSuggestions).where(and(...w)).orderBy(desc(effLevelSql), desc(alertSuggestions.lastSeen)).limit(500);
      return out(
        ["Alert", "Závažnost", "Stav", "Taktiky ATT&CK", "Počet", "Naposledy"],
        rows.map((r) => ({
          cells: [`${r.title ?? r.description}${r.agentName ? ` – ${r.agentName}` : ""}`, SOC_LABELS.severity[socSeverity(effectiveLevel(r.ruleLevel, r.exposure))], SOC_LABELS.status[r.status] ?? r.status, r.mitreTactics.map((t) => attackTactic(t)?.cs ?? t).join(", ") || "—", r.count, r.lastSeen.toISOString().slice(0, 10)],
          link: `/soc/${r.id}`,
        })),
      );
    },
  },
  {
    name: "findings_search",
    title: "Zjištění auditů",
    description: "Zjištění z auditů – otevřená, po termínu nebo podle závažnosti.",
    module: "audits",
    perm: "audits:read",
    input: z.object({
      open: z.boolean().optional(),
      overdue: z.boolean().optional(),
      severity: z.enum(["major", "minor", "observation", "recommendation"]).optional(),
    }),
    async run(ctx, a) {
      const w: (SQL | undefined)[] = [inArray(audits.companyId, ctx.companyIds)];
      if (a.open || a.overdue) w.push(inArray(auditFindings.status, ["open", "in_progress"]));
      if (a.overdue) w.push(lt(auditFindings.dueDate, today()));
      if (a.severity) w.push(eq(auditFindings.severity, a.severity as never));
      const rows = await ctx.db.select({ f: auditFindings, a: audits }).from(auditFindings).innerJoin(audits, eq(audits.id, auditFindings.auditId)).where(and(...w)).orderBy(asc(auditFindings.dueDate)).limit(500);
      return out(
        ["Zjištění", "Audit", "Závažnost", "Stav", "Termín"],
        rows.map(({ f, a: au }) => ({ cells: [`${f.code ? `${f.code} ` : ""}${f.title}`, au.code ?? au.title, f.severity, f.status, f.dueDate], link: `/audits/${au.id}` })),
      );
    },
  },
  {
    name: "suppliers_search",
    title: "Dodavatelé",
    description: "Dodavatelé – významní dle § 9, podle textu.",
    module: "suppliers",
    perm: "suppliers:read",
    input: z.object({ significant: z.boolean().optional(), q: z.string().max(100).optional() }),
    async run(ctx, a) {
      const w: (SQL | undefined)[] = [inArray(suppliers.companyId, ctx.companyIds), eq(suppliers.status, "active")];
      if (a.significant) w.push(eq(suppliers.significant, true));
      if (a.q) w.push(ilike(suppliers.name, like(a.q)));
      const rows = await ctx.db.select().from(suppliers).where(and(...w)).orderBy(asc(suppliers.name)).limit(500);
      return out(["Dodavatel", "Významný"], rows.map((r) => ({ cells: [r.name, r.significant ? "ano" : "ne"], link: `/suppliers/${r.id}` })));
    },
  },
  {
    name: "processing_search",
    title: "Činnosti zpracování (GDPR)",
    description: "Záznamy o činnostech zpracování osobních údajů – např. bez dokončeného DPIA, se zvláštními kategoriemi údajů.",
    module: "gdpr",
    perm: "gdpr:read",
    input: z.object({ dpiaMissing: z.boolean().optional(), specialCategories: z.boolean().optional(), q: z.string().max(100).optional() }),
    async run(ctx, a) {
      const w: (SQL | undefined)[] = [inArray(processingActivities.companyId, ctx.companyIds), ne(processingActivities.status, "retired")];
      if (a.q) w.push(ilike(processingActivities.name, like(a.q)));
      if (a.specialCategories) w.push(sql`cardinality(${processingActivities.specialCategories}) > 0`);
      const rows = await ctx.db.select().from(processingActivities).where(and(...w)).orderBy(asc(processingActivities.name)).limit(500);
      const done = new Set((rows.length ? await ctx.db.select({ a: dpias.activityId }).from(dpias).where(and(inArray(dpias.activityId, rows.map((r) => r.id)), eq(dpias.status, "completed"))) : []).map((x) => x.a));
      const res = rows.filter((r) => !a.dpiaMissing || (dpiaRequired(r.dpiaCriteria).required && !done.has(r.id)));
      return out(["Činnost", "Stav", "DPIA nutné", "DPIA"], res.map((r) => ({ cells: [`${r.code ? `${r.code} ` : ""}${r.name}`, r.status, dpiaRequired(r.dpiaCriteria).required ? "ano" : "ne", done.has(r.id) ? "dokončeno" : "—"], link: `/gdpr/${r.id}` })));
    },
  },
  {
    name: "cra_products",
    title: "Produkty s digitálními prvky (CRA)",
    description: "Produkty organizace podle Cyber Resilience Act – kategorie, stav, konec podpory, neuzavřené zranitelnosti komponent.",
    module: "cra",
    perm: "cra:read",
    input: z.object({ q: z.string().max(100).optional(), openVulns: z.boolean().optional() }),
    async run(ctx, a) {
      const w: (SQL | undefined)[] = [inArray(craProducts.companyId, ctx.companyIds)];
      if (a.q) w.push(ilike(craProducts.name, like(String(a.q))));
      const rows = await ctx.db.select().from(craProducts).where(and(...w)).orderBy(asc(craProducts.name)).limit(500);
      const open = rows.length
        ? await ctx.db
            .select({ p: craFindings.productId, n: count() })
            .from(craFindings)
            .where(and(inArray(craFindings.productId, rows.map((r) => r.id)), eq(craFindings.gone, false), inArray(craFindings.status, ["under_investigation", "affected"])))
            .groupBy(craFindings.productId)
        : [];
      const om = new Map(open.map((x) => [x.p, x.n]));
      const res = rows.filter((r) => !a.openVulns || (om.get(r.id) ?? 0) > 0);
      return out(["Produkt", "Kategorie", "Stav", "Podpora do", "Otevřené zranitelnosti"], res.map((r) => ({ cells: [`${r.name}${r.version ? ` ${r.version}` : ""}`, r.category ?? "—", r.status, r.supportUntil ?? "—", String(om.get(r.id) ?? 0)], link: `/cra/${r.id}` })));
    },
  },
  {
    name: "supplier_reports",
    title: "Zprávy o ujištění dodavatelů (SOC 2, ISO 27001)",
    description: "Zprávy dodavatelů – druh, období, výrok, platnost, počet CUEC a výjimek, nevyřešené výjimky.",
    module: "suppliers",
    perm: "suppliers:read",
    input: z.object({ expired: z.boolean().optional() }),
    async run(ctx, a) {
      const today = new Date().toISOString().slice(0, 10);
      const rows = await ctx.db
        .select({
          r: supplierReports,
          supplier: suppliers.name,
          cuec: sql<number>`(select count(*)::int from supplier_report_items i where i.report_id = ${supplierReports.id} and i.kind = 'cuec')`,
          exc: sql<number>`(select count(*)::int from supplier_report_items i where i.report_id = ${supplierReports.id} and i.kind = 'exception' and i.status = 'open' and i.risk_id is null)`,
        })
        .from(supplierReports)
        .innerJoin(suppliers, eq(suppliers.id, supplierReports.supplierId))
        .where(and(inArray(supplierReports.companyId, ctx.companyIds), a.expired ? sql`${supplierReports.validUntil} < ${today}` : undefined))
        .orderBy(asc(suppliers.name))
        .limit(300);
      return out(
        ["Dodavatel", "Zpráva", "Druh", "Období do", "Výrok", "Platnost do", "CUEC", "Otevřené výjimky"],
        rows.map(({ r, supplier, cuec, exc }) => ({ cells: [supplier, r.title, SUPPLIER_REPORT_LABELS.kind[r.kind], r.periodTo ?? "—", r.opinion ? SUPPLIER_REPORT_LABELS.opinion[r.opinion] : "—", r.validUntil ?? "—", String(cuec), String(exc)], link: `/suppliers/reports/${r.id}` })),
      );
    },
  },
  {
    name: "control_monitors",
    title: "Průběžné monitorování opatření",
    description: "Automatické monitory opatření (MFA, zranitelnosti po termínu, KEV, SCA, pokrytí agentem, EOL, certifikáty, SLA SOC, Secure Score) – poslední výsledek a úspěšnost za 90 dní.",
    module: "controls",
    perm: "controls:read",
    input: z.object({ failing: z.boolean().optional() }),
    async run(ctx, a) {
      const rows = await ctx.db
        .select({ m: controlMonitors, name: controls.name, code: controls.code })
        .from(controlMonitors)
        .innerJoin(controls, eq(controls.id, controlMonitors.controlId))
        .where(and(inArray(controlMonitors.companyId, ctx.companyIds), eq(controlMonitors.enabled, true), a.failing ? inArray(controlMonitors.lastResult, ["fail", "error"]) : undefined))
        .orderBy(asc(controls.code))
        .limit(300);
      return out(
        ["Opatření", "Monitor", "Poslední výsledek", "Souhrn", "Naposledy"],
        rows.map(({ m, name, code }) => ({ cells: [`${code ? `${code} ` : ""}${name}`, MONITOR_LABELS.kind[m.kind], m.lastResult ? MONITOR_LABELS.result[m.lastResult] : "—", m.lastSummary ?? "—", m.lastRunAt?.toISOString().slice(0, 10) ?? "—"], link: "/controls/monitoring" })),
      );
    },
  },
  {
    name: "soc_rule_noise",
    title: "Ladění pravidel Wazuh",
    description: "Pravidla Wazuh podle počtu alertů a podílu falešných poplachů (z verdiktů analytiků) a stav návrhů úprav (výjimky, změny úrovně) včetně simulace – podklad pro ladění detekce. Jen čtení.",
    module: "soc",
    perm: "soc:read",
    input: z.object({ days: z.number().int().min(7).max(365).optional().describe("období ve dnech (výchozí 90)"), minFpRate: z.number().min(0).max(1).optional().describe("jen pravidla s podílem falešných poplachů aspoň (0–1)") }),
    async run(ctx, a) {
      const since = new Date(Date.now() - (Number(a.days) || 90) * 86_400_000);
      const rows = await ctx.db
        .select({
          ruleId: alertSuggestions.ruleId,
          desc: sql<string>`(array_agg(${alertSuggestions.description} order by ${alertSuggestions.lastSeen} desc))[1]`,
          alerts: sql<number>`count(*)::int`,
          events: sql<number>`coalesce(sum(${alertSuggestions.count}), 0)::int`,
          decided: sql<number>`count(*) filter (where ${alertSuggestions.status} in ('accepted','dismissed'))::int`,
          fp: sql<number>`count(*) filter (where ${alertSuggestions.verdict} in ('false_positive','benign'))::int`,
          tp: sql<number>`count(*) filter (where ${alertSuggestions.verdict} = 'true_positive')::int`,
        })
        .from(alertSuggestions)
        .where(and(inArray(alertSuggestions.companyId, ctx.companyIds), eq(alertSuggestions.source, "wazuh"), gte(alertSuggestions.lastSeen, since)))
        .groupBy(alertSuggestions.ruleId)
        .orderBy(desc(sql`count(*)`))
        .limit(200);
      const props = await ctx.db.select({ ruleId: socRuleTunings.ruleId, status: socRuleTunings.status, sim: socRuleTunings.simulation }).from(socRuleTunings).where(inArray(socRuleTunings.companyId, ctx.companyIds));
      const minFp = a.minFpRate == null ? null : Number(a.minFpRate);
      return out(
        ["Pravidlo", "Alerty", "Události", "Falešné poplachy", "Skutečné útoky", "Návrhy úprav"],
        rows
          .map((r) => ({ r, rate: r.decided ? r.fp / r.decided : null }))
          .filter((x) => minFp == null || (x.rate != null && x.rate >= minFp))
          .map(({ r, rate }) => {
            const ps = props.filter((p) => p.ruleId === r.ruleId);
            const pl = ps.map((p) => `${TUNING_LABELS.status[p.status]}${p.sim ? ` (skryje ${p.sim.matched}/${p.sim.total}${p.sim.protectedAlerts.length ? `, zasáhne ${p.sim.protectedAlerts.length} útoků` : ""})` : ""}`).join("; ");
            return { cells: [`${r.ruleId} ${r.desc}`, r.alerts, r.events, rate == null ? "—" : `${Math.round(rate * 100)} % z ${r.decided}`, r.tp, pl || "—"], link: "/soc?tab=rules" };
          }),
      );
    },
  },
  {
    name: "soc2_engagements",
    title: "Zakázky SOC 2",
    description: "Zakázky ověření SOC 2 – druh zprávy, období, systém.",
    module: "soc2",
    perm: "audits:read",
    input: z.object({}),
    async run(ctx) {
      const rows = await ctx.db.select().from(soc2Engagements).where(inArray(soc2Engagements.companyId, ctx.companyIds)).orderBy(asc(soc2Engagements.createdAt)).limit(200);
      return out(["Systém", "Druh", "Období / ke dni"], rows.map((r) => ({ cells: [r.systemName || "—", r.reportType === "type1" ? "Type I" : "Type II", r.reportType === "type1" ? (r.asOf ?? "—") : `${r.periodFrom ?? "?"} – ${r.periodTo ?? "?"}`], link: `/soc2/${r.id}` })));
    },
  },
  {
    name: "ai_systems",
    title: "AI systémy (AI Act)",
    description: "Registr AI systémů s klasifikací rizika – např. vysoce rizikové, neposouzené, navržené ke schválení.",
    module: "aiact",
    perm: "aiact:read",
    input: z.object({ cls: z.enum(["unassessed", "prohibited", "high", "limited", "minimal"]).optional(), status: z.enum(["proposed", "approved", "in_use", "rejected", "retired"]).optional(), q: z.string().max(100).optional() }),
    async run(ctx, a) {
      const w: (SQL | undefined)[] = [inArray(aiSystems.companyId, ctx.companyIds)];
      if (a.status) w.push(eq(aiSystems.status, String(a.status)));
      if (a.q) w.push(ilike(aiSystems.name, like(a.q)));
      const rows = await ctx.db.select().from(aiSystems).where(and(...w)).orderBy(asc(aiSystems.name)).limit(500);
      const res = rows.map((r) => ({ r, cls: classifyAiSystem(r.screening ? AiScreening.parse(r.screening) : null).cls })).filter((x) => !a.cls || x.cls === a.cls);
      return out(["AI systém", "Klasifikace", "Stav"], res.map(({ r, cls }) => ({ cells: [`${r.code ? `${r.code} ` : ""}${r.name}`, AIACT_LABELS.cls[cls], AIACT_LABELS.status[r.status as keyof typeof AIACT_LABELS.status] ?? r.status], link: `/aiact/${r.id}` })));
    },
  },
  {
    name: "identity_findings",
    title: "Nálezy účtů (AD / Entra ID)",
    description: "Otevřené nálezy kontrol účtů v Active Directory a Entra ID – počty podle pravidla a závažnosti (neaktivní, privilegované účty, MFA…). Bez jmen účtů.",
    module: "identity",
    perm: "identity:read",
    input: z.object({ severity: z.enum(IDENTITY_SEVERITIES).optional(), rule: z.enum(IDENTITY_RULES).optional() }),
    async run(ctx, a) {
      const w: (SQL | undefined)[] = [inArray(identityFindings.companyId, ctx.companyIds), eq(identityFindings.status, "open")];
      if (a.severity) w.push(eq(identityFindings.severity, a.severity as (typeof IDENTITY_SEVERITIES)[number]));
      if (a.rule) w.push(eq(identityFindings.rule, String(a.rule)));
      const rows = await ctx.db
        .select({ rule: identityFindings.rule, severity: identityFindings.severity, n: count() })
        .from(identityFindings)
        .where(and(...w))
        .groupBy(identityFindings.rule, identityFindings.severity)
        .orderBy(desc(count()));
      return out(
        ["Pravidlo", "Závažnost", "Počet"],
        rows.map((r) => ({ cells: [IDENTITY_RULE_INFO[r.rule as IdentityRule]?.title ?? r.rule, IDENTITY_LABELS.severity[r.severity], r.n], link: `/identity?rule=${r.rule}` })),
      );
    },
  },
  {
    name: "obligations",
    title: "Povinnosti a termíny",
    description: "Povinnosti s termínem ze všech oblastí (hlášení incidentů, akce plánu zvládání, přezkumy, testy opatření, smlouvy…) – po termínu nebo blížící se.",
    module: null,
    perm: "obligations:self",
    input: z.object({ overdueOnly: z.boolean().optional() }),
    async run(ctx, a) {
      const kinds = kindsForModules(ctx.enabledModules);
      const list = await collectObligations(ctx.db, { companyIds: ctx.companyIds, leadDays: (await getNotificationSettings(ctx.db)).leadDays, kinds, includeLater: false });
      const res = list.filter((o) => ctx.byCompany.get(o.companyId)?.has(OBLIGATION_NEED[o.kind]) && (!a.overdueOnly || o.urgency === "overdue"));
      return out(
        ["Povinnost", "Druh", "Termín", "Stav", "Odpovídá"],
        res.map((o) => ({ cells: [o.title, OBLIGATION_LABELS[o.kind], o.due?.slice(0, 10) ?? "—", o.urgency === "overdue" ? "po termínu" : "blíží se", o.ownerName ?? "—"], link: o.link })),
      );
    },
  },
];

const allowedIds = (ctx: Pick<ToolCtx, "companyIds" | "byCompany">, perm: Permission) => ctx.companyIds.filter((id) => ctx.byCompany.get(id)?.has(perm));

/** Nástroje dostupné uživateli (zapnutý modul + oprávnění alespoň v jedné společnosti rozsahu). */
export function toolsFor(ctx: Pick<ToolCtx, "companyIds" | "byCompany" | "enabledModules">): QueryTool[] {
  return tools.filter((t) => (!t.module || ctx.enabledModules.includes(t.module)) && allowedIds(ctx, t.perm).length > 0);
}

export async function runTool(ctx: ToolCtx, name: string, args: unknown): Promise<ToolResult> {
  const t = toolsFor(ctx).find((x) => x.name === name);
  if (!t) throw new Error(`Nástroj „${name}“ není dostupný.`);
  const parsed = t.input.safeParse(args ?? {});
  if (!parsed.success) throw new Error(`Neplatné parametry nástroje ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "vstup"} ${i.message}`).join("; ")}`);
  return t.run({ ...ctx, companyIds: allowedIds(ctx, t.perm) }, parsed.data);
}

/** JSON Schema vstupu nástroje (pro MCP a pro zadání modelu). */
export function toolSchema(t: QueryTool): Record<string, unknown> {
  const js = z.toJSONSchema(t.input) as Record<string, unknown>;
  delete js.$schema;
  return js;
}
