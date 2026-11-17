import { secTestDef, targetFor, type SecTestId } from "@contix/shared";
import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { secTestFindings, secTestRuns, secTestScopes, tasks } from "../../db/schema";
import { probeDtos, scopeProblem } from "./service";
import { SECTEST_TASK_SOURCE } from "./tasks";

/* ============================================================
 * Ověření opravy (v1.63, ADR-157): splněný úkol na odstranění nálezu → opakovaný test sondou na cíl a port nálezu.
 * Úkol čeká ve stavu „rozpracováno“; opakovaný test, který nález nenajde, ho uzavře (closeFindingTasks),
 * jinak se úkol vrátí odpovědné osobě. Bez sondy nebo mimo platný rozsah zůstane úkol splněný s poznámkou.
 * ============================================================ */

type TaskRow = typeof tasks.$inferSelect;
const day = (d = new Date()) => d.toISOString().slice(0, 10);

/** Zavolat po přechodu úkolu do stavu „splněno“. Vrací upravený úkol, nebo null (nic se nezměnilo). */
export async function onFindingTaskDone(db: Db, task: TaskRow, userId: string | null): Promise<TaskRow | null> {
  if (task.sourceKind !== SECTEST_TASK_SOURCE || !task.sourceId) return null;
  const [f] = await db.select().from(secTestFindings).where(eq(secTestFindings.id, task.sourceId));
  if (!f || f.status !== "open") return null;
  const [run] = await db.select().from(secTestRuns).where(eq(secTestRuns.id, f.runId));
  const note = async (text: string) => {
    const [r] = await db.update(tasks).set({ completionNote: [task.completionNote, text].filter(Boolean).join("\n").slice(0, 4000), updatedAt: new Date() }).where(eq(tasks.id, task.id)).returning();
    return r ?? null;
  };
  if (!run) return note(`Opakovaný test nelze zařadit – původní běh testu už neexistuje. Ověřte opravu dalším testem.`);
  const [scope] = await db.select().from(secTestScopes).where(eq(secTestScopes.id, run.scopeId));
  const testId = f.testId as SecTestId;
  const def = secTestDef(testId);
  if (!scope || !def) return note("Opakovaný test nelze zařadit – rozsah testů neexistuje.");
  // cíl: původní cíl běhu, který odpovídá nálezu, jinak cíl odvozený z hostitele a portu nálezu
  const host = f.host.toLowerCase();
  const orig = run.targets.filter((t) => t.toLowerCase().includes(host));
  const targets = orig.length ? orig.slice(0, 4) : [targetFor(def, f.host, f.port)].filter((x): x is string => !!x);
  if (!targets.length) return note("Opakovaný test nelze zařadit – z nálezu nelze určit cíl.");
  const why = scopeProblem(scope, testId, targets);
  if (why) return note(`Opakovaný test nelze zařadit (${why}). Ověřte opravu ručně nebo po obnovení rozsahu.`);
  const probes = (await probeDtos(db, [run.companyId])).filter((p) => p.enabled);
  const probeId = run.probeId && probes.some((p) => p.id === run.probeId) ? run.probeId : (probes[0]?.id ?? null);
  if (!probeId) return note("Opakovaný test nelze zařadit – společnost nemá aktivní sondu. Ověřte opravu importem výstupu nástroje.");
  const ports = f.port && def.target === "host" && def.ports.length > 0 ? [f.port] : testId === "net.services" && f.port ? [f.port] : [];
  await db.insert(secTestRuns).values({ companyId: run.companyId, scopeId: run.scopeId, retestFindingId: f.id, testId, targets, ports, source: "probe", probeId, requestedById: userId });
  const [r] = await db
    .update(tasks)
    .set({
      status: "in_progress",
      completedAt: null,
      completionNote: [task.completionNote, `Ověřuje se opakovaným testem (zařazen ${day()}) – úkol se uzavře, jakmile test nález nenajde.`].filter(Boolean).join("\n").slice(0, 4000),
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, task.id))
    .returning();
  return r ?? null;
}
