import { ancestorsOf, TRANSFER_LABELS, type Permission, type TransferEntity, type TransferInput, type TransferResult } from "@contix/shared";
import { and, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser } from "../../auth/middleware";
import { assertScope, getCompanies, hasPermIn } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { tFor } from "../i18n/service";
import {
  assetLinks,
  assets,
  audits,
  biaAssessments,
  changes,
  continuityPlans,
  controls,
  incidents,
  ismsObjectives,
  orgUnits,
  policies,
  positions,
  processAssets,
  processes,
  riskAssets,
  riskControls,
  riskProcesses,
  risks,
  supplierAssets,
  suppliers,
  supplierQuestionnaires,
  supplierReports,
  supplierReportItems,
  trainingCourses, aiSuggestions, docChunks, docIndexState, auditFindings, controlTests, processingActivities, aiSystems, soc2Engagements, craProducts, craReports, craFindings, riskScenarioProposals, threatAssessments, evidence, evidenceControls, tasks } from "../../db/schema";

/** Tabulka a oprávnění pro přesun; `owner` = sloupec odpovědného funkčního místa (pokud je). */
const DEF = {
  assets: { t: assets, perm: "assets:write" },
  risks: { t: risks, perm: "risks:write", owner: risks.ownerPositionId },
  processes: { t: processes, perm: "processes:write", owner: processes.ownerPositionId },
  controls: { t: controls, perm: "controls:write", owner: controls.ownerPositionId },
  suppliers: { t: suppliers, perm: "suppliers:write" },
  incidents: { t: incidents, perm: "incidents:write", owner: incidents.ownerPositionId },
  audits: { t: audits, perm: "audits:write" },
  changes: { t: changes, perm: "isms:write", owner: changes.ownerPositionId },
  policies: { t: policies, perm: "policies:write", owner: policies.ownerPositionId },
  courses: { t: trainingCourses, perm: "awareness:write", owner: trainingCourses.ownerPositionId },
  plans: { t: continuityPlans, perm: "bia:write", owner: continuityPlans.ownerPositionId },
  objectives: { t: ismsObjectives, perm: "isms:write" },
  processing: { t: processingActivities, perm: "gdpr:write", owner: processingActivities.ownerPositionId },
  ai_systems: { t: aiSystems, perm: "aiact:write", owner: aiSystems.ownerPositionId },
  cra_products: { t: craProducts, perm: "cra:write", owner: craProducts.ownerPositionId },
} as const satisfies Record<TransferEntity, { t: any; perm: Permission; owner?: any }>;

/**
 * Přesun záznamů do jiné společnosti skupiny. Vyžaduje oprávnění k zápisu ve zdrojové i cílové společnosti.
 * Vazby na záznamy, které z cílové společnosti nebudou viditelné (jiná větev skupiny), se ohlásí a bez `force` se nepřesouvá.
 */
export async function transferRecords(db: Db, c: Context<AppEnv>, input: TransferInput & { force: boolean }): Promise<TransferResult> {
  const d = DEF[input.entity];
  const all = await getCompanies(db);
  const target = all.find((x) => x.id === input.targetCompanyId && x.active);
  if (!target) throw new HTTPException(400, { message: "Cílová společnost neexistuje nebo není aktivní." });
  if (!hasPermIn(c, d.perm, target.id)) throw new HTTPException(403, { message: "Nemáte oprávnění zakládat záznamy v cílové společnosti." });
  const ids = [...new Set(input.ids)];
  const rows = (await db.select({ id: d.t.id, companyId: d.t.companyId }).from(d.t).where(inArray(d.t.id, ids))) as { id: string; companyId: string }[];
  if (rows.length !== ids.length) throw new HTTPException(404, { message: "Záznam nenalezen" });
  for (const r of rows) {
    assertScope(c, r.companyId, "Záznam nenalezen");
    if (!hasPermIn(c, d.perm, r.companyId)) throw new HTTPException(403, { message: "Nemáte oprávnění upravovat záznam ve zdrojové společnosti." });
  }
  const move = rows.filter((r) => r.companyId !== target.id).map((r) => r.id);
  if (!move.length) return { moved: 0, warnings: [], needsConfirmation: false };

  // viditelné z cílové společnosti = cílová + nadřazené (sdílené zdroje holdingu)
  const visible = new Set([target.id, ...ancestorsOf(all, target.id)]);
  const name = new Map(all.map((x) => [x.id, x.name]));
  const warnings: string[] = [];
  const t = await tFor(db, c);
  const check = (what: string, list: { companyId: string; label: string }[]) => {
    const bad = list.filter((x) => !visible.has(x.companyId));
    if (bad.length) {
      const items = bad.slice(0, 5).map((x) => `${x.label} (${name.get(x.companyId) ?? "?"})`).join(", ");
      warnings.push(bad.length > 5 ? t("srv.co.transferWarnMore", { what, items, more: String(bad.length - 5) }) : t("srv.co.transferWarn", { what, items }));
    }
  };
  const assetLabel = { companyId: assets.companyId, label: assets.name };
  if (input.entity === "risks") {
    check(t("srv.co.transfer.assets"), await db.select(assetLabel).from(riskAssets).innerJoin(assets, eq(assets.id, riskAssets.assetId)).where(inArray(riskAssets.riskId, move)));
    check(
      t("srv.co.transfer.processes"),
      await db.select({ companyId: processes.companyId, label: processes.name }).from(riskProcesses).innerJoin(processes, eq(processes.id, riskProcesses.processId)).where(inArray(riskProcesses.riskId, move)),
    );
    check(
      t("srv.co.transfer.controls"),
      await db.select({ companyId: controls.companyId, label: controls.name }).from(riskControls).innerJoin(controls, eq(controls.id, riskControls.controlId)).where(inArray(riskControls.riskId, move)),
    );
  }
  if (input.entity === "assets") {
    check(
      t("srv.co.transfer.links"),
      await db
        .select(assetLabel)
        .from(assetLinks)
        .innerJoin(assets, sql`${assets.id} = case when ${inArray(assetLinks.primaryId, move)} then ${assetLinks.supportingId} else ${assetLinks.primaryId} end`)
        .where(sql`${inArray(assetLinks.primaryId, move)} or ${inArray(assetLinks.supportingId, move)}`),
    );
  }
  if (input.entity === "processes")
    check(t("srv.co.transfer.procAssets"), await db.select(assetLabel).from(processAssets).innerJoin(assets, eq(assets.id, processAssets.assetId)).where(inArray(processAssets.processId, move)));
  if (input.entity === "suppliers")
    check(t("srv.co.transfer.supAssets"), await db.select(assetLabel).from(supplierAssets).innerJoin(assets, eq(assets.id, supplierAssets.assetId)).where(inArray(supplierAssets.supplierId, move)));
  if ("owner" in d && d.owner) {
    const own = await db
      .select({ companyId: orgUnits.companyId, label: positions.name })
      .from(d.t)
      .innerJoin(positions, eq(positions.id, d.owner))
      .innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId))
      .where(inArray(d.t.id, move));
    check(t("srv.co.transfer.owner"), own);
  }
  if (warnings.length && !input.force) return { moved: 0, warnings, needsConfirmation: true };

  await db.transaction(async (tx) => {
    await tx.update(d.t).set({ companyId: target.id, updatedAt: new Date() } as never).where(inArray(d.t.id, move));
    // složky dokumentace patří společnosti – přesunutý dokument je bez složky
    if (input.entity === "policies") {
      await tx.update(policies).set({ folderId: null }).where(inArray(policies.id, move));
      // hierarchie dokumentace patří společnosti – vazba nadřazený/podřízený se mimo přesouvanou skupinu ruší
      await tx.update(policies).set({ parentId: null }).where(and(inArray(policies.id, move), isNotNull(policies.parentId), notInArray(policies.parentId, move)));
      await tx.update(policies).set({ parentId: null }).where(and(inArray(policies.parentId, move), notInArray(policies.id, move)));
      // index „Zeptej se dokumentace“ patří společnosti – přeindexuje se plánovačem
      await tx.delete(docChunks).where(inArray(docChunks.policyId, move));
      await tx.delete(docIndexState).where(inArray(docIndexState.policyId, move));
    }
    // úkoly (ADR-043) jdou se záznamem, ke kterému patří
    const taskSource: Partial<Record<string, string>> = { assets: "asset", risks: "risk", processes: "process", controls: "control", suppliers: "supplier", incidents: "incident", audits: "audit", changes: "change", policies: "policy", processing: "processing", ai_systems: "ai_system", cra_products: "cra_product" };
    if (taskSource[input.entity]) await tx.update(tasks).set({ companyId: target.id, updatedAt: new Date() }).where(and(eq(tasks.sourceKind, taskSource[input.entity]!), inArray(tasks.sourceId, move)));
    // dotazníky patří dodavateli
    if (input.entity === "suppliers") await tx.update(supplierQuestionnaires).set({ companyId: target.id, updatedAt: new Date() }).where(inArray(supplierQuestionnaires.supplierId, move));
    // zprávy o ujištění (ADR-098): vazba CUEC na opatření zdrojové společnosti se zruší (opatření tam nezůstane viditelné)
    if (input.entity === "suppliers") {
      const reps = await tx.update(supplierReports).set({ companyId: target.id, updatedAt: new Date() }).where(inArray(supplierReports.supplierId, move)).returning({ id: supplierReports.id });
      if (reps.length) await tx.update(supplierReportItems).set({ controlId: null }).where(and(inArray(supplierReportItems.reportId, reps.map((r) => r.id)), sql`${supplierReportItems.controlId} in (select id from controls where company_id <> ${target.id})`));
    }
    // návrhy rizikových scénářů patří primárnímu aktivu a profilu schopností zdrojové společnosti – v cílové se vygenerují znovu (ADR-114)
    if (input.entity === "assets") await tx.delete(riskScenarioProposals).where(inArray(riskScenarioProposals.primaryAssetId, move));
    // zdůvodnění „nerelevantní hrozby“ přechází s aktivem (posouzení se týká aktiva, ne společnosti) – v1.18, ADR-115
    if (input.entity === "assets") await tx.update(threatAssessments).set({ companyId: target.id }).where(inArray(threatAssessments.assetId, move));
    // hlášení CRA patří produktu (ADR-092)
    if (input.entity === "cra_products") await tx.update(craReports).set({ companyId: target.id, updatedAt: new Date() }).where(inArray(craReports.productId, move));
    // nálezy zranitelností patří produktu; nálezy z oznámení výrobce (CSAF) zdrojové společnosti zmizí – oznámení zůstávají u ní (v1.16)
    if (input.entity === "cra_products") {
      await tx.update(craFindings).set({ companyId: target.id, updatedAt: new Date() }).where(inArray(craFindings.productId, move));
      await tx.update(craFindings).set({ gone: true, updatedAt: new Date() }).where(and(inArray(craFindings.productId, move), eq(craFindings.source, "csaf")));
    }
    // zakázka SOC 2 patří auditu (ADR-091)
    if (input.entity === "audits") await tx.update(soc2Engagements).set({ companyId: target.id, updatedAt: new Date() }).where(inArray(soc2Engagements.auditId, move));
    if (input.entity === "audits") {
      const eng = await tx.select({ id: soc2Engagements.id }).from(soc2Engagements).where(inArray(soc2Engagements.auditId, move));
      if (eng.length) await tx.update(tasks).set({ companyId: target.id, updatedAt: new Date() }).where(and(eq(tasks.sourceKind, "soc2"), inArray(tasks.sourceId, eng.map((e) => e.id))));
    }
    // BIA patří procesu
    if (input.entity === "processes") await tx.update(biaAssessments).set({ companyId: target.id, updatedAt: new Date() }).where(inArray(biaAssessments.processId, move));
    // návrhy AI patří riziku / opatření (auditní stopa jde se záznamem)
    if (["risks", "controls", "assets", "incidents", "policies"].includes(input.entity)) await tx.update(aiSuggestions).set({ companyId: target.id }).where(inArray(aiSuggestions.entityId, move));
    if (input.entity === "audits")
      await tx
        .update(aiSuggestions)
        .set({ companyId: target.id })
        .where(inArray(aiSuggestions.entityId, tx.select({ id: auditFindings.id }).from(auditFindings).where(inArray(auditFindings.auditId, move))));
    // testy opatření jdou s opatřením; důkazy jen pokud se týkají výhradně přesouvaných opatření
    if (input.entity === "controls") {
      await tx.update(controlTests).set({ companyId: target.id, updatedAt: new Date() }).where(inArray(controlTests.controlId, move));
      const links = await tx.select().from(evidenceControls).where(inArray(evidenceControls.evidenceId, tx.select({ id: evidenceControls.evidenceId }).from(evidenceControls).where(inArray(evidenceControls.controlId, move))));
      const moving = new Set(move);
      const evIds = [...new Set(links.map((l) => l.evidenceId))].filter((id) => links.filter((l) => l.evidenceId === id).every((l) => moving.has(l.controlId)));
      if (evIds.length) await tx.update(evidence).set({ companyId: target.id, updatedAt: new Date() }).where(inArray(evidence.id, evIds));
    }
  });
  await audit(db, {
    c,
    user: currentUser(c),
    action: "company.records_transferred",
    entityType: input.entity,
    entityId: move.length === 1 ? move[0] : undefined,
    details: { entity: input.entity, label: TRANSFER_LABELS[input.entity], ids: move, from: [...new Set(rows.map((r) => r.companyId))], to: target.id, warnings, note: input.note ?? null },
  });
  return { moved: move.length, warnings, needsConfirmation: false };
}
