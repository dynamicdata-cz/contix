import { profileOf, allRequirements,
  cisIgOf,
  frameworksInScope,
  catalogRelated,
  mappedRequirements,
  ControlCrosswalkInput,
  type ControlCrosswalkResult,
  complianceScore,
  CONTROL_LABELS,
  ControlInput,
  ControlPatch,
  CONTROL_STATUSES,
  deriveCompliance,
  emptyComplianceCounts,
  FrameworkIdSchema,
  frameworkOrder,
  FRAMEWORKS,
  GenerateControlsInput,
  RequirementAssessmentInput,
  requirementById,
  requirementsOf,
  riskScore,
  type Compliance,
  type ComplianceSummary,
  type ControlDetail,
  type ControlListItem,
  type ControlStatus,
  type Effectiveness,
  type FrameworkId,
  type RequirementRow,
  ancestorsOf,
  type Translate,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, hasPerm, requireModule, requirePerm } from "../../auth/middleware";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import { assertScope, getCompanies, inScope, riskPolicies, settingsFor, soleCompany, targetCompany, visibleIds } from "../../auth/scope";
import type { Db } from "../../db/client";
import { CS_T, tFor } from "../i18n/service";
import {
  assets,
  controlAssets,
  controlRequirements,
  controls,
  positionHolders,
  positions,
  requirementAssessments,
  riskControls,
  risks,
  evidence,
  evidenceControls,
  evidenceRequirements,
} from "../../db/schema";

type Ctx = Context<AppEnv>;
const FrameworkParam = FrameworkIdSchema;

/** Stav všech požadavků (SoA) – posouzení + navázaná opatření + odvozená míra shody. */
/**
 * Posouzení se vedou za společnost; do odvozené míry shody se počítají opatření společnosti
 * i opatření nadřazených společností (skupinová opatření holdingu).
 */
export async function loadRequirementRows(db: Db, companyId: string, fw?: FrameworkId, t: Translate = CS_T): Promise<RequirementRow[]> {
  const reqs = fw ? requirementsOf(fw) : allRequirements();
  const ids = reqs.map((r) => r.id);
  const lineage = ancestorsOf(await getCompanies(db), companyId);
  const [assess, links] = await Promise.all([
    db
      .select({ a: requirementAssessments, ownerPositionName: positions.name })
      .from(requirementAssessments)
      .leftJoin(positions, eq(positions.id, requirementAssessments.ownerPositionId))
      .where(eq(requirementAssessments.companyId, companyId)),
    db
      .select({
        requirementId: controlRequirements.requirementId,
        id: controls.id,
        code: controls.code,
        name: controls.name,
        status: controls.status,
        effectiveness: controls.effectiveness,
        companyId: controls.companyId,
      })
      .from(controlRequirements)
      .innerJoin(controls, eq(controls.id, controlRequirements.controlId))
      .where(and(ids.length ? inArray(controlRequirements.requirementId, ids) : sql`false`, inArray(controls.companyId, lineage))),
  ]);
  const byReq = new Map<string, typeof links>();
  for (const l of links) byReq.set(l.requirementId, [...(byReq.get(l.requirementId) ?? []), l]);
  const aMap = new Map(assess.map((x) => [x.a.requirementId, x]));
  // důkazy: přímo k požadavku + přes namapovaná opatření (bez duplicit)
  const ctlIds = [...new Set(links.map((l) => l.id))];
  const [direct, viaCtl] = await Promise.all([
    db
      .select({ requirementId: evidenceRequirements.requirementId, evidenceId: evidence.id })
      .from(evidenceRequirements)
      .innerJoin(evidence, eq(evidence.id, evidenceRequirements.evidenceId))
      .where(and(ids.length ? inArray(evidenceRequirements.requirementId, ids) : sql`false`, inArray(evidence.companyId, lineage))),
    ctlIds.length ? db.select({ controlId: evidenceControls.controlId, evidenceId: evidenceControls.evidenceId }).from(evidenceControls).where(inArray(evidenceControls.controlId, ctlIds)) : [],
  ]);
  const evByReq = new Map<string, Set<string>>();
  const addEv = (req: string, ev: string) => (evByReq.get(req) ?? evByReq.set(req, new Set()).get(req)!).add(ev);
  for (const d of direct) addEv(d.requirementId, d.evidenceId);
  for (const l of links) for (const v of viaCtl) if (v.controlId === l.id) addEv(l.requirementId, v.evidenceId);
  // SOC 2: volitelné kategorie mimo rozsah zprávy jsou bez výslovného posouzení neaplikovatelné
  const st = reqs.some((r) => r.framework === "soc2" || r.framework === "cis8") ? await settingsFor(db, null, companyId) : null;
  const soc2Scope = new Set<string>(st?.soc2Scope ?? []);
  const cisIg = st?.cisIg ?? 3;
  // SOC 2: volitelné kategorie mimo rozsah zprávy; CIS: dílčí opatření vyšší implementační skupiny než zvolená
  const outOfScope = (r: { id: string; framework: string; section: string }) =>
    (r.framework === "soc2" && !r.section.startsWith("CC") && !soc2Scope.has(r.section)) || (r.framework === "cis8" && (cisIgOf(r.id) ?? 1) > cisIg);
  return reqs.map((r): RequirementRow => {
    const a = aMap.get(r.id);
    const ctl = byReq.get(r.id) ?? [];
    const applicable = a?.a.applicable ?? !outOfScope(r);
    const derived: Compliance = applicable ? deriveCompliance(ctl) : "not_applicable";
    const manual = a?.a.compliance ?? null;
    return {
      id: r.id,
      framework: r.framework,
      section: r.section,
      sectionTitle: r.sectionTitle,
      ref: r.ref,
      text: r.text,
      lead: r.lead,
      points: r.points,
      ...(r.guidance ? { guidance: r.guidance } : {}),
      ...(r.level ? { level: r.level } : {}),
      applicable,
      justification: a?.a.justification ?? (outOfScope(r) ? (r.framework === "cis8" ? t("srv.ctl.cisOutOfScope", { ig: cisIg }) : t("srv.ctl.soc2OutOfScope")) : null),
      compensating: a?.a.compensating ?? null,
      implementationNote: a?.a.implementationNote ?? null,
      manualCompliance: manual,
      derivedCompliance: derived,
      compliance: !applicable ? "not_applicable" : (manual ?? derived),
      priority: a?.a.priority ?? null,
      dueDate: a?.a.dueDate ?? null,
      ownerPositionId: a?.a.ownerPositionId ?? null,
      ownerPositionName: a?.ownerPositionName ?? null,
      controls: ctl.map(({ id, code, name, status, companyId: co }) => ({ id, code, name, status, ...(co !== companyId ? { inherited: true } : {}) })),
      evidenceCount: evByReq.get(r.id)?.size ?? 0,
      updatedAt: a?.a.updatedAt.toISOString() ?? null,
    };
  });
}

export function summarize(fw: FrameworkId, rows: RequirementRow[]): ComplianceSummary {
  const counts = emptyComplianceCounts();
  const sections = new Map<string, { title: string; rows: RequirementRow[] }>();
  for (const r of rows) {
    counts[r.compliance]++;
    const s = sections.get(r.section) ?? { title: r.sectionTitle, rows: [] };
    s.rows.push(r);
    sections.set(r.section, s);
  }
  return {
    framework: fw,
    total: rows.length,
    applicable: rows.filter((r) => r.applicable).length,
    byCompliance: counts,
    score: complianceScore(counts),
    sections: [...sections.entries()].map(([section, s]) => {
      const c = emptyComplianceCounts();
      for (const r of s.rows) c[r.compliance]++;
      return { section, title: s.title, total: s.rows.length, applicable: s.rows.filter((r) => r.applicable).length, score: complianceScore(c), byCompliance: c };
    }),
  };
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  // ochrana před CSV injection (vzorce v Excelu)
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export function controlRoutes(db: Db) {
  async function canEdit(c: Ctx, ctl: { ownerPositionId: string | null }) {
    if (hasPerm(c, "controls:write")) return true;
    if (!ctl.ownerPositionId) return false;
    const [h] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(positionHolders)
      .where(and(eq(positionHolders.positionId, ctl.ownerPositionId), eq(positionHolders.userId, currentUser(c).id)));
    return h!.n > 0;
  }

  async function listControls(where?: ReturnType<typeof and>): Promise<ControlListItem[]> {
    const rows = await db
      .select({
        c: controls,
        ownerPositionName: positions.name,
        reqIds: sql<string[]>`coalesce((select array_agg(cr.requirement_id) from control_requirements cr where cr.control_id = ${controls.id}), '{}')`,
        riskCount: sql<number>`(select count(*)::int from risk_controls rc where rc.control_id = ${controls.id})`,
      })
      .from(controls)
      .leftJoin(positions, eq(positions.id, controls.ownerPositionId))
      .where(where)
      .orderBy(asc(controls.code), asc(controls.name));
    return rows.map(({ c, ownerPositionName, reqIds, riskCount }) => ({
      id: c.id,
      companyId: c.companyId,
      code: c.code,
      name: c.name,
      category: c.category,
      status: c.status,
      effectiveness: c.effectiveness,
      ownerPositionName,
      plannedDate: c.plannedDate,
      priority: c.priority,
      requirementCount: reqIds.length,
      riskCount,
      frameworks: [...new Set(reqIds.map((r) => r.split(":")[0] as FrameworkId))],
      updatedAt: c.updatedAt.toISOString(),
    }));
  }

  async function detail(c: Ctx, id: string): Promise<ControlDetail> {
    const [item] = await listControls(eq(controls.id, id));
    if (!item) throw new HTTPException(404, { message: "Opatření nenalezeno" });
    const [row] = await db.select().from(controls).where(eq(controls.id, id));
    if (!row || !(await visibleIds(db, c)).includes(row.companyId)) throw new HTTPException(404, { message: "Opatření nenalezeno" });
    const policies = await riskPolicies(db, await getSettings(db));
    const [reqIds, riskRows, assetRows] = await Promise.all([
      db.select({ id: controlRequirements.requirementId }).from(controlRequirements).where(eq(controlRequirements.controlId, id)),
      db.select({ r: risks }).from(riskControls).innerJoin(risks, eq(risks.id, riskControls.riskId)).where(eq(riskControls.controlId, id)),
      db
        .select({ id: assets.id, name: assets.name, assetType: assets.assetType, healthStatus: assets.healthStatus })
        .from(controlAssets)
        .innerJoin(assets, eq(assets.id, controlAssets.assetId))
        .where(eq(controlAssets.controlId, id))
        .orderBy(asc(assets.name)),
    ]);
    const reqs = reqIds
      .map((x) => requirementById(x.id))
      .filter((r) => r != null)
      .sort((a, b) => frameworkOrder(a.framework) - frameworkOrder(b.framework) || a.order - b.order);
    return {
      ...item,
      description: row!.description,
      ownerPositionId: row!.ownerPositionId,
      implementation: row!.implementation,
      evidence: row!.evidence,
      lastReviewAt: row!.lastReviewAt,
      requirements: reqs.map((r) => ({ id: r.id, framework: r.framework, ref: r.ref, section: r.section, text: r.text })),
      risks: riskRows.map(({ r }) => ({ id: r.id, code: r.code, name: r.name, level: riskScore(policies.get(r.companyId)!, r, r.scaleLevels).level })),
      assets: assetRows,
      canEdit: await canEdit(c, row!),
    };
  }

  async function setLinks(controlId: string, v: { requirementIds?: string[]; assetIds?: string[] }) {
    if (v.requirementIds) {
      const valid = [...new Set(v.requirementIds)].filter((r) => requirementById(r));
      await db.delete(controlRequirements).where(eq(controlRequirements.controlId, controlId));
      if (valid.length) await db.insert(controlRequirements).values(valid.map((requirementId) => ({ controlId, requirementId })));
    }
    if (v.assetIds) {
      await db.delete(controlAssets).where(eq(controlAssets.controlId, controlId));
      const ids = [...new Set(v.assetIds)];
      if (ids.length) await db.insert(controlAssets).values(ids.map((assetId) => ({ controlId, assetId })));
    }
  }

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "controls"))

      /* ---------- rámce a míra shody ---------- */
      .get("/frameworks", requirePerm("controls:read"), async (c) => {
        const companyId = soleCompany(c);
        const rows = await loadRequirementRows(db, companyId);
        // rámce v rozsahu (ADR-074): zákon + vyhláška podle režimu + zvolené; nezvoleno = ty, které se už posuzují
        const st = await settingsFor(db, null, companyId);
        const assessed = [...new Set(rows.filter((r) => r.updatedAt || r.controls.length || r.evidenceCount).map((r) => r.framework))];
        const scope = new Set(frameworksInScope(profileOf(st), st.frameworks, assessed));
        return c.json(FRAMEWORKS.map((f) => ({ ...f, inScope: scope.has(f.id), summary: summarize(f.id, rows.filter((r) => r.framework === f.id)) })));
      })
      .get(
        "/requirements",
        requirePerm("controls:read"),
        zValidator("query", z.object({ framework: FrameworkParam, section: z.string().optional(), q: z.string().optional() })),
        async (c) => {
          const { framework, section, q } = c.req.valid("query");
          let rows = await loadRequirementRows(db, soleCompany(c), framework, await tFor(db, c));
          if (section) rows = rows.filter((r) => r.section === section);
          if (q) {
            const s = q.toLowerCase();
            rows = rows.filter((r) => `${r.ref} ${r.text} ${r.points.join(" ")}`.toLowerCase().includes(s));
          }
          return c.json(rows);
        },
      )
      .put(
        "/assessments",
        requirePerm("controls:write"),
        zValidator("json", RequirementAssessmentInput.extend({ requirementId: z.string().max(100) })),
        async (c) => {
          const { requirementId, ...input } = c.req.valid("json");
          const companyId = soleCompany(c);
          if (!requirementById(requirementId)) throw new HTTPException(404, { message: "Požadavek nenalezen" });
          if (!input.applicable && !input.justification?.trim())
            throw new HTTPException(400, { message: "U neaplikovaného opatření je povinné odůvodnění (§ 8 odst. 1 písm. f) bod 1)." });
          const values = {
            companyId,
            requirementId,
            applicable: input.applicable,
            justification: input.justification ?? null,
            compensating: input.compensating ?? null,
            compliance: input.compliance ?? null,
            implementationNote: input.implementationNote ?? null,
            priority: input.priority ?? null,
            dueDate: input.dueDate ?? null,
            ownerPositionId: input.ownerPositionId ?? null,
            updatedById: currentUser(c).id,
          };
          await db
            .insert(requirementAssessments)
            .values(values)
            .onConflictDoUpdate({ target: [requirementAssessments.companyId, requirementAssessments.requirementId], set: { ...values, updatedAt: new Date() } });
          await audit(db, { c, user: currentUser(c), action: "soa.assessed", entityType: "requirement", details: values });
          const [row] = (await loadRequirementRows(db, companyId, requirementId.split(":")[0] as FrameworkId, await tFor(db, c))).filter((r) => r.id === requirementId);
          return c.json(row);
        },
      )
      /** Export prohlášení o aplikovatelnosti (409) / přehledu bezpečnostních opatření (410) do CSV. */
      .get("/soa.csv", requirePerm("controls:read"), zValidator("query", z.object({ framework: FrameworkParam })), async (c) => {
        const { framework } = c.req.valid("query");
        const t = await tFor(db, c);
        const rows = await loadRequirementRows(db, soleCompany(c), framework, t);
        const fwName = FRAMEWORKS.find((f) => f.id === framework)!.name;
        const header = [
          t("srv.ctl.colRef"),
          t("srv.ctl.colArea"),
          t("srv.ctl.colRequirement"),
          t("srv.ctl.colApplied"),
          t("srv.ctl.colCompliance"),
          t("srv.ctl.colImplementation"),
          t("srv.ctl.colControls"),
          t("srv.ctl.colJustification"),
          t("srv.ctl.colCompensating"),
          t("srv.ctl.colPriority"),
          t("srv.ctl.colDue"),
          t("srv.ctl.colOwner"),
        ];
        const lines = rows.map((r) =>
          [
            r.ref,
            `${r.section} ${r.sectionTitle}`,
            [r.lead, r.text, ...r.points].filter(Boolean).join(" "),
            r.applicable ? t("srv.ctl.yes") : t("srv.ctl.no"),
            t.lbl(CONTROL_LABELS.compliance[r.compliance]),
            r.implementationNote ?? "",
            r.controls.map((x) => `${x.code ? `${x.code} ` : ""}${x.name} (${t.lbl(CONTROL_LABELS.status[x.status])})`).join("; "),
            r.justification ?? "",
            r.compensating ?? "",
            r.priority ?? "",
            r.dueDate ?? "",
            r.ownerPositionName ?? "",
          ]
            .map(csvCell)
            .join(";"),
        );
        const body = `﻿${csvCell(t.lbl(fwName))}\n${header.map(csvCell).join(";")}\n${lines.join("\n")}\n`;
        await audit(db, { c, user: currentUser(c), action: "soa.exported", details: { framework } });
        return c.body(body, 200, {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="soa-${framework}.csv"`,
        });
      })

      /* ---------- katalog opatření ---------- */
      .get(
        "/",
        requirePerm("controls:read"),
        zValidator(
          "query",
          z.object({ q: z.string().optional(), status: z.enum(CONTROL_STATUSES).optional(), framework: FrameworkParam.optional(), riskId: z.string().uuid().optional() }),
        ),
        async (c) => {
          const q = c.req.valid("query");
          // withGroup: i skupinová opatření nadřazených společností (pro vazby)
          const where = [c.req.query("withGroup") === "1" ? inArray(controls.companyId, await visibleIds(db, c)) : inScope(c, controls.companyId)];
          if (q.q) where.push(or(ilike(controls.name, `%${q.q}%`), ilike(controls.code, `%${q.q}%`))!);
          if (q.status) where.push(eq(controls.status, q.status));
          if (q.framework) where.push(sql`exists (select 1 from control_requirements cr where cr.control_id = ${controls.id} and cr.requirement_id like ${`${q.framework}:%`})`);
          if (q.riskId) where.push(sql`exists (select 1 from risk_controls rc where rc.control_id = ${controls.id} and rc.risk_id = ${q.riskId})`);
          return c.json(await listControls(where.length ? and(...where) : undefined));
        },
      )
      .post("/", requirePerm("controls:write"), zValidator("json", ControlInput), async (c) => {
        const { requirementIds, assetIds, companyId: requested, ...input } = c.req.valid("json");
        const [ctl] = await db.insert(controls).values({ ...input, companyId: targetCompany(c, requested, "controls:write") }).returning();
        await setLinks(ctl!.id, { requirementIds, assetIds });
        await audit(db, { c, user: currentUser(c), action: "control.created", entityType: "control", entityId: ctl!.id, details: { name: ctl!.name } });
        return c.json(await detail(c, ctl!.id), 201);
      })
      /**
       * Doplní k opatřením výchozího katalogu (kód V-xx = § vyhlášky 409, N-xx = § 410) příbuzné požadavky vybraných rámců.
       * Jen přidává chybějící vazby (nic neodebírá); bez `apply` vrátí náhled.
       */
      .post("/crosswalk", requirePerm("controls:write"), zValidator("json", ControlCrosswalkInput), async (c) => {
        const { frameworks, apply } = c.req.valid("json");
        const companyId = soleCompany(c);
        const want = new Set<string>(frameworks);
        // výchozí katalog (V-xx / N-xx) podle crosswalku vyhlášky; všechna opatření podle mapování z knihovny rámců (ADR-079)
        const list = await db.select({ id: controls.id, code: controls.code, name: controls.name }).from(controls).where(eq(controls.companyId, companyId));
        const links = list.length ? await db.select().from(controlRequirements).where(inArray(controlRequirements.controlId, list.map((x) => x.id))) : [];
        const items: ControlCrosswalkResult["items"] = [];
        for (const ctl of list.sort((a, b) => (a.code ?? a.name).localeCompare(b.code ?? b.name))) {
          const have = new Set(links.filter((l) => l.controlId === ctl.id).map((l) => l.requirementId));
          const catalog = /^[VN]-\d{2}$/.test(ctl.code ?? "") ? catalogRelated(ctl.code!.startsWith("V") ? "cz409" : "cz410", String(Number(ctl.code!.slice(2)))) : [];
          const viaMapping = [...have].flatMap((id) => mappedRequirements(id));
          const seen = new Set<string>();
          const add = [...catalog, ...viaMapping]
            .filter((r) => want.has(r.framework) && !have.has(r.id) && !seen.has(r.id) && (seen.add(r.id), true))
            .map((r) => ({ id: r.id, framework: r.framework, ref: r.ref, text: r.text.slice(0, 200) }));
          if (add.length) items.push({ controlId: ctl.id, code: ctl.code ?? "", name: ctl.name, add });
        }
        const total = items.reduce((n, i) => n + i.add.length, 0);
        if (apply && total) {
          for (const i of items) await db.insert(controlRequirements).values(i.add.map((r) => ({ controlId: i.controlId, requirementId: r.id }))).onConflictDoNothing();
          await audit(db, { c, user: currentUser(c), action: "control.crosswalk_applied", details: { frameworks, controls: items.length, requirements: total } });
        }
        return c.json({ items, total, applied: apply && total > 0 } satisfies ControlCrosswalkResult);
      })

      /** Vytvoří výchozí katalog opatření – jedno opatření na každý § vyhlášky (existující se přeskočí dle kódu). */
      .post("/generate", requirePerm("controls:write"), zValidator("json", GenerateControlsInput), async (c) => {
        const { regime, includeCrosswalk } = c.req.valid("json");
        const companyId = soleCompany(c);
        const fw: FrameworkId = regime === "higher" ? "cz409" : "cz410";
        const reqs = requirementsOf(fw);
        const sections = [...new Map(reqs.map((r) => [r.section, r.sectionTitle])).entries()];
        const existing = new Set((await db.select({ code: controls.code }).from(controls).where(eq(controls.companyId, companyId))).map((x) => x.code));
        // CIS Controls mapovat jen, když je společnost sleduje (jinak by se CIS „automaticky“ objevil mezi sledovanými rámci)
        const withCis = includeCrosswalk && ((await settingsFor(db, null, companyId)).frameworks ?? []).includes("cis8");
        let created = 0;
        for (const [section, title] of sections) {
          const par = section.replace("§ ", "");
          const code = `${fw === "cz409" ? "V" : "N"}-${par.padStart(2, "0")}`;
          if (existing.has(code)) continue;
          const own = reqs.filter((r) => r.section === section).map((r) => r.id);
          // pro 410: příbuzné § vyhlášky 409 → jejich ISO/DORA/NIS2 mapování
          const related = includeCrosswalk ? catalogRelated(fw, par).filter((r) => withCis || r.framework !== "cis8").map((r) => r.id) : [];
          const category = ["17"].includes(par) && fw === "cz409" ? "physical" : ["10"].includes(par) && fw === "cz409" ? "people" : Number(par) >= 17 || (fw === "cz410" && Number(par) >= 7) ? "technical" : "organizational";
          const [ctl] = await db
            .insert(controls)
            .values({ companyId, code, name: title, category, description: `Opatření dle ${section} ${fw === "cz409" ? "vyhlášky č. 409/2025 Sb." : "vyhlášky č. 410/2025 Sb."}` })
            .returning();
          await setLinks(ctl!.id, { requirementIds: [...own, ...related] });
          created++;
        }
        await audit(db, { c, user: currentUser(c), action: "control.catalog_generated", details: { regime, created } });
        return c.json({ created, skipped: sections.length - created });
      })
      .get("/:id", requirePerm("controls:read"), async (c) => c.json(await detail(c, c.req.param("id"))))
      .patch("/:id", requirePerm("controls:read"), zValidator("json", ControlPatch), async (c) => {
        const id = c.req.param("id");
        const [cur] = await db.select().from(controls).where(eq(controls.id, id));
        if (!cur) throw new HTTPException(404, { message: "Opatření nenalezeno" });
        assertScope(c, cur.companyId, "Opatření nenalezeno");
        if (!(await canEdit(c, cur))) throw new HTTPException(403, { message: "Opatření upravuje jeho vlastník nebo správce opatření" });
        const { requirementIds, assetIds, ...rest } = c.req.valid("json");
        const input = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Partial<typeof controls.$inferInsert>;
        if (!hasPerm(c, "controls:write") && ("ownerPositionId" in input || requirementIds))
          throw new HTTPException(403, { message: "Vlastníka a mapování na požadavky mění správce opatření" });
        if (Object.keys(input).length) await db.update(controls).set({ ...input, updatedAt: new Date() }).where(eq(controls.id, id));
        await setLinks(id, { requirementIds, assetIds });
        await audit(db, { c, user: currentUser(c), action: "control.updated", entityType: "control", entityId: id, details: { ...input, requirementIds, assetIds } });
        return c.json(await detail(c, id));
      })
      .delete("/:id", requirePerm("controls:write"), async (c) => {
        const id = c.req.param("id");
        const [cur] = await db.select({ companyId: controls.companyId }).from(controls).where(eq(controls.id, id));
        assertScope(c, cur?.companyId, "Opatření nenalezeno");
        const [ctl] = await db.delete(controls).where(eq(controls.id, id)).returning({ name: controls.name });
        if (!ctl) throw new HTTPException(404, { message: "Opatření nenalezeno" });
        await audit(db, { c, user: currentUser(c), action: "control.deleted", entityType: "control", entityId: id, details: ctl });
        return c.body(null, 204);
      })
  );
}

export type { ControlStatus, Effectiveness };
