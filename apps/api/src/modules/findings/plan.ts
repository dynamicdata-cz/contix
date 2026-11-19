import { FINDING_LABELS, FINDING_PLAN_DUE_DAYS, FINDING_SOURCES, parseFindingPlan, unifiedStatus, type FindingPlanDto, type FindingPlanStepDto, type FindingPlanViewDto, type FindingSource, type Translate, type UnifiedFindingDto, type UnifiedSeverity } from "@contix/shared";
import { eq, inArray, sql } from "drizzle-orm";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { appSettings, assets, assetVulnerabilities, auditFindings, hostFindings, positions, secTestFindings, tasks, users } from "../../db/schema";
import { orgSnapshot } from "../org/hierarchy";
import { technicalAssignee } from "../sectests/tasks";
import { clientFor, getAiSettings } from "../ai/service";
import type { FetchLike } from "../discovery/connectors/wazuh";
import { AiUnavailable } from "../sectests/ai";

/* ============================================================
 * Plán oprav nálezů (v1.70, ADR-163): lokální model dostane nejvýš 60 otevřených nálezů podle priority
 * (bez názvů serverů, IP adres, aktiv a osob – pseudonymy F1…, H1…, A1…) a navrhne kroky (co opravit spolu
 * a v jakém pořadí). Reference se ověří proti seznamu; výsledek se uloží za společnost (poslední plán).
 * ============================================================ */

const SYSTEM = [
  "Jsi vedoucí týmu správy IT a bezpečnosti. Sestav plán oprav nálezů – plán oprav nálezů pro správce.",
  "Seskup nálezy, které odstraní jedna oprava (stejná příčina, stejný server nebo stejná konfigurace), a seřaď kroky od nejdůležitějšího.",
  "Rozhoduj podle priority (vyšší = dříve), závažnosti, termínu a toho, zda jedna oprava vyřeší víc nálezů.",
  "Názvy serverů a aktiv jsou nahrazeny zkratkami (H1, A1…) – nepoužívej jiné názvy. Nepiš návod na zneužití.",
  "Každý krok musí odkazovat na nálezy přes jejich zkratky F1, F2… (pole refs). Náročnost: low / medium / high.",
  "Odpověz POUZE jedním objektem JSON:",
  '{"summary": "2–4 věty pro vedení", "steps": [{"title": "co udělat", "refs": ["F1", "F3"], "why": "proč právě teď a co to vyřeší", "effort": "low"}]}',
].join("\n");

const key = (companyId: string) => `findings.plan.${companyId}`;

export async function lastFindingPlan(db: Db, companyId: string): Promise<FindingPlanDto | null> {
  const [r] = await db.select().from(appSettings).where(eq(appSettings.key, key(companyId)));
  return (r?.value as FindingPlanDto | undefined) ?? null;
}

const PLAN_SOURCE: Record<string, "host_finding" | "sectest_finding" | "vulnerability"> = { host: "host_finding", sectest: "sectest_finding", vulnerability: "vulnerability" };
function planTaskSource(items: { key: string }[]): { sourceKind?: "host_finding" | "sectest_finding" | "vulnerability"; sourceId?: string } {
  if (items.length !== 1) return {};
  const [src, id] = items[0]!.key.split(":");
  const kind = PLAN_SOURCE[src ?? ""];
  return kind && id ? { sourceKind: kind, sourceId: id } : {};
}

export async function buildFindingPlan(db: Db, config: Config, companyId: string, items: UnifiedFindingDto[], t: Translate, fetchImpl?: FetchLike): Promise<FindingPlanDto> {
  const s = await getAiSettings(db);
  if (!s.enabled) throw new AiUnavailable("AI asistent není zapnutý.");
  const list = items.filter((i) => i.companyId === companyId && (i.status === "open" || i.status === "in_progress")).sort((a, b) => b.priority - a.priority).slice(0, 60);
  const hosts = new Map<string, string>();
  const assetsP = new Map<string, string>();
  const H = (x: string) => hosts.get(x) ?? (hosts.set(x, `H${hosts.size + 1}`), hosts.get(x)!);
  const A = (x: string | null) => (x ? (assetsP.get(x) ?? (assetsP.set(x, `A${assetsP.size + 1}`), assetsP.get(x)!)) : "—");
  const refs = new Map<string, { key: string; title: string; link: string; severity: UnifiedFindingDto["severity"] }>();
  const lines = list.map((f, i) => {
    const ref = `F${i + 1}`;
    refs.set(ref, { key: f.key, title: f.title, link: f.link, severity: f.severity });
    // server / cíl → pseudonym; u nálezů sběrače bez předmětu (může to být jméno účtu)
    let title = f.title;
    let detail = f.detail;
    if (f.source === "sectest") {
      const host = f.detail.replace(/:\d+$/, "");
      title = title.replaceAll(host, H(host));
      detail = detail.replaceAll(host, H(host));
    } else if (f.source === "host") {
      title = title.split(" – ")[0]!;
      detail = H(f.detail);
    }
    const task = f.task ? `úkol ${f.task.status}${f.dueDate ? `, termín ${f.dueDate}` : ""}` : "bez úkolu";
    return `${ref} | ${t.lbl(FINDING_LABELS.source[f.source])} | ${f.severity} | priorita ${f.priority} | aktivum ${A(f.assetId)} | ${task} | ${title.slice(0, 200)} | ${detail.slice(0, 120)}`;
  });
  const lang = t.locale === "cs" ? "Texty v JSON piš česky." : `Write the JSON texts in the user's language (${t.locale}).`;
  const r = await clientFor(s, config, fetchImpl).chat([
    { role: "system", content: [SYSTEM, lang, s.instructions ? `Pokyny organizace: ${s.instructions}` : ""].filter(Boolean).join("\n") },
    { role: "user", content: [`Nálezy (${lines.length}), řazené podle priority:`, ...lines].join("\n") },
  ]);
  const plan = parseFindingPlan(r.text, refs);
  const dto: FindingPlanDto = { companyId, generatedAt: new Date().toISOString(), model: (r.model ?? s.model).slice(0, 200), summary: plan.summary, steps: plan.steps, considered: list.length };
  await savePlan(db, dto);
  return dto;
}

async function savePlan(db: Db, dto: FindingPlanDto) {
  await db
    .insert(appSettings)
    .values({ key: key(dto.companyId), value: dto })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: dto, updatedAt: new Date() } });
}

/** Nálezy podle klíčů `zdroj:id` → stav (jednotný) a aktivum. Smazané nálezy chybí. */
export async function findingStates(db: Db, keys: string[]): Promise<Map<string, { status: string; assetId: string | null }>> {
  const by = new Map<FindingSource, string[]>();
  for (const k of keys) {
    const [src, id] = k.split(":") as [FindingSource, string];
    if ((FINDING_SOURCES as readonly string[]).includes(src) && /^[0-9a-f-]{36}$/.test(id ?? "")) by.set(src, [...(by.get(src) ?? []), id]);
  }
  const out = new Map<string, { status: string; assetId: string | null }>();
  const put = (src: FindingSource, rows: { id: string; status: string; assetId: string | null }[]) => rows.forEach((r) => out.set(`${src}:${r.id}`, { status: unifiedStatus(r.status), assetId: r.assetId }));
  const ids = (s: FindingSource) => by.get(s) ?? [];
  await Promise.all([
    ids("sectest").length ? db.select({ id: secTestFindings.id, status: secTestFindings.status, assetId: secTestFindings.assetId }).from(secTestFindings).where(inArray(secTestFindings.id, ids("sectest"))).then((r) => put("sectest", r)) : null,
    ids("host").length ? db.select({ id: hostFindings.id, status: hostFindings.status, assetId: hostFindings.assetId }).from(hostFindings).where(inArray(hostFindings.id, ids("host"))).then((r) => put("host", r)) : null,
    ids("vulnerability").length
      ? db.select({ id: assetVulnerabilities.id, status: sql<string>`${assetVulnerabilities.status}::text`, assetId: assetVulnerabilities.assetId }).from(assetVulnerabilities).where(inArray(assetVulnerabilities.id, ids("vulnerability"))).then((r) => put("vulnerability", r))
      : null,
    ids("audit").length ? db.select({ id: auditFindings.id, status: sql<string>`${auditFindings.status}::text`, assetId: auditFindings.assetId }).from(auditFindings).where(inArray(auditFindings.id, ids("audit"))).then((r) => put("audit", r)) : null,
  ]);
  return out;
}

const OPEN = new Set(["open", "in_progress"]);

/** Plán s plněním (v1.71, ADR-164): u kroku úkol, kolik nálezů už není otevřených, a zda je krok splněný. */
export async function planView(db: Db, plan: FindingPlanDto): Promise<FindingPlanViewDto> {
  const states = await findingStates(db, plan.steps.flatMap((s) => s.items.map((i) => i.key)));
  const taskIds = plan.steps.map((s) => s.taskId).filter((x): x is string => !!x);
  const ts = taskIds.length
    ? await db
        .select({ id: tasks.id, seq: tasks.seq, status: tasks.status, dueDate: tasks.dueDate, assigneeName: users.displayName, ownerName: positions.name })
        .from(tasks)
        .leftJoin(users, eq(users.id, tasks.assigneeUserId))
        .leftJoin(positions, eq(positions.id, tasks.ownerPositionId))
        .where(inArray(tasks.id, taskIds))
    : [];
  const tm = new Map(ts.map((t) => [t.id, { id: t.id, code: `#${t.seq}`, status: t.status, dueDate: t.dueDate, assigneeName: t.assigneeName ?? t.ownerName }]));
  const steps: FindingPlanStepDto[] = plan.steps.map((s) => {
    const task = (s.taskId && tm.get(s.taskId)) || null;
    // smazaný nález se počítá jako vyřešený
    const resolved = s.items.filter((i) => !OPEN.has(states.get(i.key)?.status ?? "fixed")).length;
    return { ...s, taskId: task ? task.id : null, task, resolved, done: task?.status === "done" || resolved === s.items.length };
  });
  return {
    ...plan,
    steps,
    progress: {
      steps: steps.length,
      done: steps.filter((s) => s.done).length,
      items: steps.reduce((a, s) => a + s.items.length, 0),
      resolved: steps.reduce((a, s) => a + s.resolved, 0),
      withTask: steps.filter((s) => s.task).length,
    },
  };
}

const SEV_PRIO: Record<UnifiedSeverity, "high" | "medium" | "low"> = { critical: "high", high: "high", medium: "medium", low: "low", info: "low" };
const SEV_RANK: Record<UnifiedSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

/**
 * Úkoly z kroků plánu (v1.71, ADR-164): jeden úkol za krok – řešitel = garant aktiva, které má v kroku nejvíc nálezů
 * (technický garant → zástupce → vlastník), jinak ten, kdo úkoly zakládá; termín podle náročnosti kroku,
 * priorita podle nejzávažnějšího nálezu. Krok, který už úkol má (a úkol existuje), se přeskočí.
 */
export async function createPlanTasks(db: Db, plan: FindingPlanDto, stepIdx: number[], userId: string, t: Translate, now = new Date()): Promise<{ created: number; skipped: number; taskIds: string[] }> {
  const existing = new Set(
    (await db.select({ id: tasks.id }).from(tasks).where(inArray(tasks.id, plan.steps.map((s) => s.taskId).filter((x): x is string => !!x).concat(["00000000-0000-0000-0000-000000000000"])))).map((r) => r.id),
  );
  const states = await findingStates(db, plan.steps.flatMap((s) => s.items.map((i) => i.key)));
  const assetIds = [...new Set([...states.values()].map((s) => s.assetId).filter((x): x is string => !!x))];
  const owners = assetIds.length
    ? new Map(
        (await db.select({ id: assets.id, ownerUserId: assets.ownerUserId, technicalOwnerUserId: assets.technicalOwnerUserId, technicalDeputyUserId: assets.technicalDeputyUserId }).from(assets).where(inArray(assets.id, assetIds))).map((a) => [a.id, a]),
      )
    : new Map();
  const snap = await orgSnapshot(db);
  const res = { created: 0, skipped: 0, taskIds: [] as string[] };
  const day = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  for (const i of [...new Set(stepIdx)].sort((a, b) => a - b)) {
    const st = plan.steps[i];
    if (!st || (st.taskId && existing.has(st.taskId))) {
      res.skipped++;
      continue;
    }
    // aktivum s nejvíc nálezy kroku
    const cnt = new Map<string, number>();
    for (const it of st.items) {
      const a = states.get(it.key)?.assetId;
      if (a) cnt.set(a, (cnt.get(a) ?? 0) + 1);
    }
    const top = [...cnt].sort((a, b) => b[1] - a[1])[0]?.[0];
    const who = technicalAssignee(snap, top ? owners.get(top) : null, plan.companyId);
    const worst = [...st.items].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])[0]?.severity ?? "medium";
    const description = [
      st.why,
      `${t("srv.plan.taskFindings")}:`,
      ...st.items.map((x) => `- [${t.lbl(FINDING_LABELS.severity[x.severity])}] ${x.title} – ${x.link}`),
      t("srv.plan.taskHint"),
    ]
      .filter(Boolean)
      .join("\n");
    const [row] = await db
      .insert(tasks)
      .values({
        companyId: plan.companyId,
        title: `${t("srv.plan.taskPrefix")}: ${st.title}`.slice(0, 500),
        description,
        ownerPositionId: who.positionId,
        assigneeUserId: who.userId ?? userId,
        dueDate: day(FINDING_PLAN_DUE_DAYS[st.effort ?? "medium"]),
        priority: SEV_PRIO[worst],
        status: "open",
        createdById: userId,
        // krok s jedním nálezem → úkol navázaný na nález (v1.88): v registru je vidět, že se řeší, a uzavře se s ním
        ...planTaskSource(st.items),
      })
      .returning({ id: tasks.id });
    st.taskId = row!.id;
    res.created++;
    res.taskIds.push(row!.id);
  }
  if (res.created) await savePlan(db, plan);
  return res;
}
