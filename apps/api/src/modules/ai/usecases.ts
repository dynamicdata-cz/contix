import { profileOf, AI_ASSET_FIELDS,
  AI_INCIDENT_FIELDS,
  LABELS as ASSET_LABELS,
  AUDIT_LABELS,
  INCIDENT_LABELS,
  parseAssetFields,
  parseGaps,
  parseLegalTasks,
  parseTextFields,
  parseTreatment,
  requirementById,
  requirementsOf,
  type AiItem,
  type AiUseCase,
  type FrameworkId,
} from "@contix/shared";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { settingsFor } from "../../auth/scope";
import type { Db } from "../../db/client";
import {
  assetLinks,
  assetSoftware,
  assets,
  auditFindings,
  audits,
  incidentAssets,
  incidents,
  legalActs,
  legalChanges,
  legalReviews,
  legalTasks,
  policies,
  policyComments,
  policyFiles,
  policyRequirements,
  policyVersions,
  processAssets,
  processes,
} from "../../db/schema";
import { affectedOf, changeDiff } from "../legislation/service";
import type { PreparedRequest } from "./service";

/* ============================================================
 * Další úlohy AI asistenta (v0.16): klasifikace aktiva, nápravná opatření ke zjištění,
 * shrnutí incidentu, kontrola dokumentu vůči požadavkům vyhlášky.
 * Pravidla stejná jako u ostatních úloh: minimalizovaný kontext bez osob, validace výstupu, aplikace jen po rozhodnutí.
 * ============================================================ */

const short = (t: string | null | undefined, n = 600) =>
  t ? (t.length > n ? `${t.slice(0, n)}…` : t) : null;
/** Text požadavku i s úvodní větou ustanovení („Vrcholné vedení se prokazatelně seznamuje … se zprávou o přezkoumání“). */
const reqText = (q: { text: string; lead?: string | null }, max: number) => short(q.lead ? `${q.lead} … ${q.text}` : q.text, max)!;
const msgs = (system: string, user: string): PreparedRequest["messages"] => [
  { role: "system", content: system },
  { role: "user", content: user },
];

export async function prepareOther(
  db: Db,
  useCase: AiUseCase,
  entityId: string,
  system: string,
  note: string,
  opts: { note?: string },
): Promise<PreparedRequest | null> {
  /* ---------- klasifikace aktiva ---------- */
  if (useCase === "asset_classification") {
    const [a] = await db.select().from(assets).where(eq(assets.id, entityId));
    if (!a) return null;
    const [sw, procs, primaries, supporting] = await Promise.all([
      db
        .select({ name: assetSoftware.name })
        .from(assetSoftware)
        .where(eq(assetSoftware.assetId, a.id))
        .limit(40),
      db
        .selectDistinct({
          name: processes.name,
          criticality: processes.criticality,
        })
        .from(processAssets)
        .innerJoin(processes, eq(processes.id, processAssets.processId))
        .where(eq(processAssets.assetId, a.id)),
      db
        .select({
          name: assets.name,
          type: assets.assetType,
          criticality: assets.criticality,
          c: assets.confidentiality,
          i: assets.integrity,
          av: assets.availability,
        })
        .from(assetLinks)
        .innerJoin(assets, eq(assets.id, assetLinks.primaryId))
        .where(eq(assetLinks.supportingId, a.id)),
      db
        .select({ name: assets.name, type: assets.assetType })
        .from(assetLinks)
        .innerJoin(assets, eq(assets.id, assetLinks.supportingId))
        .where(eq(assetLinks.primaryId, a.id)),
    ]);
    const current = {
      criticality: a.criticality,
      confidentiality: a.confidentiality,
      integrity: a.integrity,
      availability: a.availability,
    };
    const input = {
      asset: {
        name: a.name,
        type: ASSET_LABELS.assetType[a.assetType] ?? a.assetType,
        class: a.assetClass,
        description: short(a.description),
        os: [a.osName, a.osVersion].filter(Boolean).join(" ") || null,
        environment: a.environment,
        lifecycle: a.lifecycleStatus,
        tags: a.tags,
      },
      current,
      software: sw.map((s) => s.name),
      processes: procs,
      supportsPrimaryAssets: primaries,
      supportedBy: supporting.slice(0, 20),
    };
    const user = [
      "Navrhni klasifikaci aktiva: kritičnost (low | medium | high | critical) a hodnocení CIA – důvěrnost, integrita, dostupnost na stupnici 1–4",
      "(1 nízká, 2 střední, 3 vysoká, 4 kritická dle přílohy č. 1 vyhl. 409/2025 Sb.). Podpůrné aktivum odvoď od primárních aktiv a procesů, které podporuje.",
      "Uveď jen hodnoty, které by se měly ZMĚNIT oproti současným (current), s krátkým zdůvodněním.",
      "Schéma odpovědi:",
      '{"summary": "1–2 věty", "fields": [{"field": "criticality|confidentiality|integrity|availability", "value": "high" nebo 3, "reason": "proč"}]}',
      "Aktivum (JSON):",
      JSON.stringify(input),
      note,
    ].join("\n");
    return {
      companyId: a.companyId,
      entityType: "asset",
      entityName: a.name,
      input: { ...input, note: opts.note ?? null },
      messages: msgs(system, user),
      validate: (raw) => {
        const p = parseAssetFields(raw, current);
        return {
          summary: p.summary,
          items: p.items.map((i) => ({ kind: "field" as const, ...i })),
        };
      },
    };
  }

  /* ---------- nápravná opatření ke zjištění ---------- */
  if (useCase === "finding_remediation") {
    const [row] = await db
      .select({ f: auditFindings, a: audits })
      .from(auditFindings)
      .innerJoin(audits, eq(audits.id, auditFindings.auditId))
      .where(eq(auditFindings.id, entityId));
    if (!row) return null;
    const { f, a } = row;
    const req = f.requirementId ? requirementById(f.requirementId) : null;
    const settings = await settingsFor(db, null, a.companyId);
    const fw: FrameworkId = profileOf(settings).defaultFramework;
    const sections = [
      ...new Map(
        requirementsOf(fw).map((q) => [
          q.section.replace("§ ", ""),
          q.sectionTitle,
        ]),
      ).entries(),
    ];
    const input = {
      finding: {
        title: f.title,
        description: short(f.description, 1500),
        severity: AUDIT_LABELS.severity[f.severity] ?? f.severity,
        currentCorrectiveAction: short(f.correctiveAction, 600),
      },
      requirement: req
        ? { ref: req.ref, text: short(req.text, 500), framework: req.framework }
        : null,
      audit: { title: a.title, type: a.auditType },
      decree:
        fw === "cz409"
          ? "vyhláška č. 409/2025 Sb."
          : "vyhláška č. 410/2025 Sb.",
    };
    const user = [
      "Navrhni 2–5 konkrétních nápravných opatření, která odstraní příčinu zjištění z auditu kybernetické bezpečnosti a zabrání jeho opakování.",
      "Každé opatření musí být ověřitelné (co, jak, výstup). Nenavrhuj, co už je v currentCorrectiveAction.",
      `Uveď čísla § ${input.decree}, ke kterým opatření patří – jen z tohoto seznamu: ${sections.map(([p, t]) => `§ ${p} ${t}`).join("; ")}`,
      "Schéma odpovědi:",
      '{"summary": "1 věta o příčině", "measures": [{"title": "krátký název", "description": "co konkrétně udělat", "objective": "jak se ověří splnění", "category": "organizational|technical|physical|people", "paragraphs": ["16"]}]}',
      "Zjištění (JSON):",
      JSON.stringify(input),
      note,
    ].join("\n");
    const known = new Set(sections.map(([p]) => p));
    return {
      companyId: a.companyId,
      entityType: "finding",
      entityName: f.code ? `${f.code} ${f.title}` : f.title,
      input: { ...input, note: opts.note ?? null },
      messages: msgs(system, user),
      validate: (raw) => {
        const p = parseTreatment(raw, (x) => known.has(x));
        return {
          summary: p.summary,
          items: p.items.map((i) => ({ kind: "treatment" as const, ...i })),
        };
      },
    };
  }

  /* ---------- shrnutí incidentu ---------- */
  if (useCase === "incident_summary") {
    const [i] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, entityId));
    if (!i) return null;
    const affected = await db
      .select({ name: assets.name, criticality: assets.criticality })
      .from(incidentAssets)
      .innerJoin(assets, eq(assets.id, incidentAssets.targetId))
      .where(eq(incidentAssets.incidentId, i.id));
    const input = {
      incident: {
        title: i.title,
        kind: INCIDENT_LABELS.kind[i.kind] ?? i.kind,
        category: INCIDENT_LABELS.category[i.category] ?? i.category,
        cause: INCIDENT_LABELS.cause[i.cause] ?? i.cause,
        status: i.status,
        detectedAt: i.detectedAt,
        resolvedAt: i.resolvedAt,
        description: short(i.description, 2000),
        impactDescription: short(i.impactDescription, 1000),
        containment: short(i.containment, 1000),
        rootCause: short(i.rootCause, 1000),
        lessonsLearned: short(i.lessonsLearned, 1000),
        downtimeHours: i.downtimeHours,
        personalDataBreach: i.personalDataBreach,
        affectedUsers: i.affectedUsers,
      },
      timeline: (i.timeline ?? [])
        .slice(-40)
        .map((t) => ({ at: t.at, text: short(t.text, 300) })),
      affectedAssets: affected,
    };
    const user = [
      "Připrav pro vedení věcné shrnutí bezpečnostní události / incidentu (co se stalo, dopad, jak bylo zvládnuto, stav) – max. 8 vět, bez spekulací.",
      "Dále navrhni texty polí, která jsou prázdná nebo neúplná: impactDescription (popis dopadu), rootCause (příčina – jen pokud vyplývá z podkladů, jinak vynech),",
      "lessonsLearned (poučení a doporučená opatření, § 14 vyhl. 409/2025 Sb.). Nevymýšlej fakta, která v podkladech nejsou.",
      "Schéma odpovědi:",
      '{"summary": "shrnutí pro vedení", "impactDescription": "…", "rootCause": "…", "lessonsLearned": "…"}',
      "Incident (JSON):",
      JSON.stringify(input),
      note,
    ].join("\n");
    const filled = (f: string) => !!(i as Record<string, unknown>)[f];
    return {
      companyId: i.companyId,
      entityType: "incident",
      entityName: i.code ? `${i.code} ${i.title}` : i.title,
      input: { ...input, note: opts.note ?? null },
      messages: msgs(system, user),
      validate: (raw) => {
        const p = parseTextFields(
          raw,
          ["summary", ...AI_INCIDENT_FIELDS],
          filled,
        );
        return {
          summary: null,
          items: p.items.map((x) => ({ kind: "text" as const, ...x })),
        };
      },
    };
  }

  /* ---------- skóre dokumentu vůči požadavkům + náměty ke zlepšení (policy_review) ---------- */
  if (useCase === "policy_review") {
    const [p] = await db.select().from(policies).where(eq(policies.id, entityId));
    if (!p) return null;
    const [v] = await db.select().from(policyVersions).where(eq(policyVersions.policyId, p.id)).orderBy(desc(policyVersions.createdAt)).limit(1);
    // text verze v CONTIXu, jinak text nahraných souborů (Word / PDF po převodu)
    let content = v?.content?.trim() ?? "";
    if (!content && v) {
      const files = await db
        .select({ text: policyFiles.text, filename: policyFiles.filename })
        .from(policyFiles)
        .where(and(eq(policyFiles.versionId, v.id), isNull(policyFiles.supersededAt)))
        .orderBy(asc(policyFiles.uploadedAt));
      const base = (n: string) => n.replace(/\.[^.]+$/, "").toLowerCase();
      const office = new Set(files.filter((f) => f.text && !/\.pdf$/i.test(f.filename)).map((f) => base(f.filename)));
      content = files
        .filter((f) => f.text && !(/\.pdf$/i.test(f.filename) && office.has(base(f.filename))))
        .map((f) => f.text!)
        .join("\n\n")
        .trim();
    }
    if (!v || !content)
      throw new Error("Dokument nemá text – vložte obsah verze nebo nahrajte soubor (text Wordu / PDF se získá automaticky po převodu).");
    // požadavky: oddíly vyhlášky (bezpečnostní dokumentace) + navázané požadavky libovolného rámce
    const settings = await settingsFor(db, null, p.companyId);
    const fw: FrameworkId = profileOf(settings).defaultFramework;
    const linked = (await db.select({ id: policyRequirements.requirementId }).from(policyRequirements).where(eq(policyRequirements.policyId, p.id))).map((x) => x.id);
    const bySection = p.system === "isms" ? requirementsOf(fw).filter((q) => p.sections.includes(q.section)) : [];
    const reqs = [...new Map([...bySection, ...linked.map((id) => requirementById(id)).filter((q): q is NonNullable<typeof q> => !!q)].map((q) => [q.id, q])).values()].slice(0, 80);
    if (!reqs.length)
      throw new Error("Dokument nemá přiřazené požadavky – vyberte oddíly vyhlášky nebo navažte požadavky (karta dokumentu → Vazby dokumentu).");
    const text = content.length > 60_000 ? `${content.slice(0, 60_000)}\n[…zkráceno…]` : content;
    const input = {
      document: { title: p.title, type: p.docType, system: p.system, version: v.version, chars: content.length },
      frameworks: [...new Set(reqs.map((q) => q.framework))],
      requirements: reqs.length,
    };
    const user = [
      `Posuď, zda text dokumentu „${p.title}“ pokrývá požadavky uvedené níže (právní předpisy a normy).`,
      "U KAŽDÉHO požadavku urči status: covered (věcně a dostatečně upraveno), partial (zmíněno, ale chybí některá podmínka nebo bod), missing (chybí).",
      "Hodnoť VĚCNÝ obsah. Chybějící citace čísla paragrafu nebo zákona NENÍ nedostatek – nesnižuj kvůli ní status a nenavrhuj doplnění citací.",
      "covered jen tehdy, když dokument splňuje všechny podmínky požadavku (lhůty, četnost, kvalifikace, zákazy, výčet bodů); jinak partial.",
      "Pokud dokument danou oblast výslovně svěřuje navazujícímu dokumentu (např. „podrobnosti stanoví směrnice POL-07“), jde o covered – v reason uveď, kterým dokumentem.",
      "Text požadavku začíná úvodní větou ustanovení (…) – posuzuj písmeno vždy v jejím kontextu.",
      "Ve zdůvodnění (reason) u covered/partial uveď, kde v dokumentu je (kapitola / krátká citace do 15 slov); u missing, co chybí.",
      "U partial a missing navrhni konkrétní námět ke zlepšení (suggestion): co a kam do dokumentu doplnit, 1–3 věty.",
      "U norem ISO máš jen číslo a stručný popisek požadavku – hodnoť podle smyslu, necituj text normy.",
      "Schéma odpovědi:",
      '{"summary": "celkové hodnocení 1–2 věty", "requirements": [{"requirementId": "přesné ID", "status": "covered|partial|missing", "reason": "…", "suggestion": "…"}]}',
      "Požadavky (ID | text):",
      reqs.map((q) => `${q.id} | ${q.ref} ${reqText(q, 260)}${q.points.length ? ` (${short(q.points.join(" "), 400)})` : ""}`).join("\n"),
      "Text dokumentu:",
      "<<<",
      text,
      ">>>",
      note,
    ].join("\n");
    const known = new Map(reqs.map((q) => [q.id, { ref: q.ref, text: reqText(q, 300) }]));
    return {
      companyId: p.companyId,
      entityType: "policy",
      entityName: p.code ? `${p.code} ${p.title}` : p.title,
      input: { ...input, versionId: v.id, note: opts.note ?? null },
      messages: msgs(system, user),
      validate: (raw) => {
        const r = parseGaps(raw, known);
        return { summary: r.summary, items: r.items.map((x) => ({ kind: "gap" as const, ...x })) };
      },
    };
  }

  /* ---------- změna předpisu: shrnutí a návrh úkolů (legal_change) ---------- */
  if (useCase === "legal_change") {
    const [rv] = await db.select().from(legalReviews).where(eq(legalReviews.id, entityId));
    if (!rv) return null;
    const [ch] = await db.select().from(legalChanges).where(eq(legalChanges.id, rv.changeId));
    const [act] = await db.select().from(legalActs).where(eq(legalActs.id, ch!.actId));
    const diff = await changeDiff(db, ch!, act!);
    const affected = await affectedOf(db, rv.companyId, act!, diff);
    const docs = await db
      .select({ id: policies.id, code: policies.code, title: policies.title, system: policies.system })
      .from(policies)
      .where(and(eq(policies.companyId, rv.companyId), sql`${policies.status} <> 'retired'`))
      .orderBy(asc(policies.code))
      .limit(200);
    const docMap = new Map(docs.map((d) => [d.id, d.code ? `${d.code} ${d.title}` : d.title]));
    let budget = 24_000;
    const lines: string[] = [];
    for (const d of diff) {
      const t = `[${d.kind === "added" ? "NOVÉ" : d.kind === "removed" ? "ZRUŠENO" : "ZMĚNA"}] ${d.label}${d.requirementIds?.length ? ` {${d.requirementIds.join(", ")}}` : ""}\n${d.kind !== "added" ? `PŮVODNĚ: ${short(d.before, 1200)}\n` : ""}${d.kind !== "removed" ? `NOVĚ: ${short(d.after, 1200)}` : ""}`;
      if (budget - t.length < 0) {
        lines.push(`[…a dalších ${diff.length - lines.length} změn…]`);
        break;
      }
      budget -= t.length;
      lines.push(t);
    }
    const input = { act: { code: act!.code, title: act!.title }, changes: { added: ch!.added, removed: ch!.removed, modified: ch!.modified }, affectedRequirements: affected.requirements.length, documents: docs.length };
    const user = [
      `Předpis ${act!.code} (${act!.title}) má nové znění. Níže jsou změněné části (fragmenty) a dotčené požadavky v CONTIX ({ID}).`,
      "1) Shrň změnu srozumitelně pro gestora (co se mění, od kdy, pro koho) – 3–6 vět, bez právních domněnek nad rámec textu.",
      "2) Navrhni konkrétní úkoly pro organizaci (např. upravit dokument, opatření, školení). U úkolu uveď policyId z nabídky dokumentů, pokud se týká konkrétního dokumentu, a requirementId, pokud se týká požadavku.",
      "Posouzení dopadu provede a potvrdí gestor – ty jen navrhuješ.",
      "Schéma odpovědi:",
      '{"summary": "shrnutí změny", "tasks": [{"title": "krátký název", "description": "co udělat a proč", "policyId": "id nebo null", "requirementId": "id nebo null"}]}',
      "Změny:",
      lines.join("\n\n"),
      "Dokumenty organizace (id | označení název):",
      docs.map((d) => `${d.id} | ${docMap.get(d.id)}`).join("\n"),
      note,
    ].join("\n");
    return {
      companyId: rv.companyId,
      entityType: "legal_review",
      entityName: `Změna ${act!.code}`,
      input: { ...input, note: opts.note ?? null },
      messages: msgs(system, user),
      validate: (raw) => {
        const r = parseLegalTasks(raw, docMap, (id) => requirementById(id));
        return { summary: r.summary, items: r.items.map((x) => ({ kind: "legal_task" as const, ...x })) };
      },
    };
  }
  return null;
}

/** Aplikace přijatých položek pro další úlohy. */
export async function applyOther(
  db: Db,
  useCase: AiUseCase,
  entityId: string,
  chosen: AiItem[],
  ctx: { userId: string | null; summary: string | null; companyId: string } = { userId: null, summary: null, companyId: "" },
): Promise<Record<string, number>> {
  // změna předpisu: shrnutí do posouzení (gestor ho potvrdí ve svém posouzení) + navržené úkoly
  if (useCase === "legal_change") {
    const [rv] = await db.select().from(legalReviews).where(eq(legalReviews.id, entityId));
    if (!rv) return { createdTasks: 0 };
    if (ctx.summary) await db.update(legalReviews).set({ aiSummary: ctx.summary, status: rv.status === "new" ? "in_review" : rv.status, updatedAt: new Date() }).where(eq(legalReviews.id, rv.id));
    const tasks = chosen.filter((x) => x.kind === "legal_task") as (AiItem & { kind: "legal_task" })[];
    if (tasks.length)
      await db.insert(legalTasks).values(
        tasks.map((t) => ({
          companyId: rv.companyId,
          reviewId: rv.id,
          title: t.title,
          description: t.description || null,
          ownerPositionId: rv.ownerPositionId,
          dueDate: rv.dueDate,
          policyId: t.policyId,
          requirementId: t.requirementId,
          createdById: ctx.userId,
        })),
      );
    return { createdTasks: tasks.length };
  }
  // skóre dokumentu: náměty ke zlepšení → připomínky k dokumentu (vyřizuje gestor)
  if (useCase === "policy_review") {
    const gaps = chosen.filter((x) => x.kind === "gap" && x.status !== "covered") as (AiItem & { kind: "gap" })[];
    const [v] = await db.select({ id: policyVersions.id }).from(policyVersions).where(eq(policyVersions.policyId, entityId)).orderBy(desc(policyVersions.createdAt)).limit(1);
    if (gaps.length)
      await db.insert(policyComments).values(
        gaps.map((g) => ({
          policyId: entityId,
          versionId: v?.id ?? null,
          userId: ctx.userId,
          reference: `${g.ref} (${g.status === "missing" ? "chybí" : "částečně"})`.slice(0, 200),
          text: `[Návrh AI] ${g.suggestion || g.reason || g.text}`.slice(0, 4000),
        })),
      );
    return { createdComments: gaps.length };
  }
  if (useCase === "asset_classification") {
    const set: Record<string, string | number> = {};
    for (const it of chosen)
      if (
        it.kind === "field" &&
        (AI_ASSET_FIELDS as readonly string[]).includes(it.field)
      )
        set[it.field] = it.value;
    if (Object.keys(set).length)
      await db
        .update(assets)
        .set({ ...set, updatedAt: new Date() } as never)
        .where(eq(assets.id, entityId));
    return { updatedFields: Object.keys(set).length };
  }
  if (useCase === "finding_remediation") {
    const [f] = await db
      .select({ correctiveAction: auditFindings.correctiveAction })
      .from(auditFindings)
      .where(eq(auditFindings.id, entityId));
    const text = chosen
      .filter((x) => x.kind === "treatment")
      .map((x) => {
        const t = x as Extract<AiItem, { kind: "treatment" }>;
        return `• ${t.title}${t.description ? ` – ${t.description}` : ""}${t.objective ? ` (ověření: ${t.objective})` : ""}${t.paragraphs.length ? ` [${t.paragraphs.map((p) => `§ ${p}`).join(", ")}]` : ""}`;
      })
      .join("\n");
    if (text)
      await db
        .update(auditFindings)
        .set({
          correctiveAction: [f?.correctiveAction, text]
            .filter(Boolean)
            .join("\n"),
          updatedAt: new Date(),
        })
        .where(eq(auditFindings.id, entityId));
    return { addedMeasures: chosen.length };
  }
  if (useCase === "incident_summary") {
    const [i] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, entityId));
    const set: Record<string, string> = {};
    for (const it of chosen) {
      if (
        it.kind !== "text" ||
        it.field === "summary" ||
        !(AI_INCIDENT_FIELDS as readonly string[]).includes(it.field)
      )
        continue;
      const cur = (i as Record<string, unknown> | undefined)?.[it.field] as
        | string
        | null
        | undefined;
      set[it.field] = cur ? `${cur}\n\n${it.text}` : it.text;
    }
    if (Object.keys(set).length)
      await db
        .update(incidents)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(incidents.id, entityId));
    return { updatedFields: Object.keys(set).length };
  }
  return { acknowledged: chosen.length };
}
