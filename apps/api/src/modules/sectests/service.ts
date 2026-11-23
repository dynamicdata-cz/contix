import { mirrorSecTestCves, registerTlsEndpoints } from "./cves";
import { recomputeHealth } from "../vulnerabilities/service";
import {
  CONTIX_VERSION,
  PROBE_TOKEN_PREFIX,
  scopeAllows,
  secTestDef,
  type ProbeConnectionDto,
  type ProbeConnectionInput,
  ProbeResultInput,
  type SecTestFindingDto,
  type SecTestHostFacts,
  type SecTestId,
  type SecTestParseResult,
  type SecTestRunDto,
  type SecTestScopeDto,
  type SecTestBatchDto,
  followUpsFromFacts,
  targetFor,
} from "@contix/shared";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { decrypt, encrypt } from "../../auth/crypto";
import { appSecret, type Config } from "../../config";
import type { Db } from "../../db/client";
import { assets, connections, controls, secTestBatches, secTestFindings, secTestRuns, secTestScopes, users } from "../../db/schema";
import { hostMatcher } from "../vulnerabilities/scans";
import { afterRetest, autoTasksForRun, closeFindingTasks, findingTasks, reassignFindingTasks } from "./tasks";
import { mergeResults, parseSecTest } from "./parsers";

/* ============================================================
 * Bezpečnostní testy (v1.56, ADR-153): sondy (připojení `probe` s tokenem), rozsahy, běhy a nálezy.
 * ============================================================ */

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const today = () => new Date().toISOString().slice(0, 10);
/** Úloha, kterou sonda převzala a neodevzdala, se po této době označí jako selhaná. */
export const RUN_TIMEOUT_MS = 3 * 3600_000;

/* ---------- sondy ---------- */

export function newProbeToken() {
  const token = `${PROBE_TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
  return { token, hash: sha256(token), prefix: token.slice(0, 12) };
}

export async function saveProbe(db: Db, config: Config, id: string | null, i: ProbeConnectionInput): Promise<{ id: string; token: string | null }> {
  const values = { kind: "probe", name: i.name, enabled: i.enabled ?? true, companyId: i.companyId ?? null, updatedAt: new Date() };
  if (id) {
    await db.update(connections).set(values).where(and(eq(connections.id, id), eq(connections.kind, "probe")));
    return { id, token: null };
  }
  const t = newProbeToken();
  const [r] = await db
    .insert(connections)
    .values({ ...values, config: { tokenHash: t.hash, tokenPrefix: t.prefix }, secrets: { token: encrypt(t.token, appSecret(config)) } })
    .returning({ id: connections.id });
  return { id: r!.id, token: t.token };
}

export async function rotateProbeToken(db: Db, config: Config, id: string): Promise<string> {
  const t = newProbeToken();
  const [row] = await db.select().from(connections).where(and(eq(connections.id, id), eq(connections.kind, "probe")));
  if (!row) throw new Error("not found");
  await db
    .update(connections)
    .set({ config: { ...(row.config as Record<string, unknown>), tokenHash: t.hash, tokenPrefix: t.prefix }, secrets: { token: encrypt(t.token, appSecret(config)) }, updatedAt: new Date() })
    .where(eq(connections.id, id));
  return t.token;
}

export function probeToken(row: typeof connections.$inferSelect, config: Config): string | null {
  try {
    return row.secrets?.token ? decrypt(row.secrets.token, appSecret(config)) : null;
  } catch {
    return null;
  }
}

export async function probeByToken(db: Db, token: string) {
  if (!token.startsWith(PROBE_TOKEN_PREFIX)) return null;
  const [row] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.kind, "probe"), eq(connections.enabled, true), sql`${connections.config}->>'tokenHash' = ${sha256(token)}`));
  return row ?? null;
}

export async function probeDtos(db: Db, companyIds?: string[]): Promise<ProbeConnectionDto[]> {
  const rows = await db.select().from(connections).where(eq(connections.kind, "probe")).orderBy(connections.createdAt);
  const vis = companyIds ? rows.filter((r) => !r.companyId || companyIds.includes(r.companyId)) : rows;
  if (!vis.length) return [];
  const q = await db
    .select({ id: secTestRuns.probeId, n: count() })
    .from(secTestRuns)
    .where(and(eq(secTestRuns.status, "queued"), inArray(secTestRuns.probeId, vis.map((r) => r.id))))
    .groupBy(secTestRuns.probeId);
  return vis.map((r) => {
    const cfg = r.config as { tokenPrefix?: string; lastSeenAt?: string; hostname?: string; version?: string; tools?: Record<string, boolean> };
    return {
      id: r.id,
      kind: "probe",
      name: r.name,
      enabled: r.enabled,
      companyId: r.companyId,
      tokenPrefix: cfg.tokenPrefix ?? "",
      installerReady: !!r.secrets?.token,
      lastSeenAt: cfg.lastSeenAt ?? null,
      hostname: cfg.hostname ?? null,
      version: cfg.version ?? null,
      tools: cfg.tools ?? {},
      queued: q.find((x) => x.id === r.id)?.n ?? 0,
    };
  });
}

/** Sonda se hlásí: uloží se stav a převezme se nejstarší čekající úloha (pro ni, nebo pro libovolnou sondu její společnosti). */
export async function pollProbe(db: Db, probe: typeof connections.$inferSelect, info: { version: string; hostname: string; tools: Record<string, boolean> }, now = new Date()) {
  await db
    .update(connections)
    .set({ config: { ...(probe.config as Record<string, unknown>), lastSeenAt: now.toISOString(), hostname: info.hostname, version: info.version, tools: info.tools } })
    .where(eq(connections.id, probe.id));
  // úlohy, které sonda převzala a nevrátila, po čase selžou (sonda spadla, restart)
  await db
    .update(secTestRuns)
    .set({ status: "failed", error: "Sonda nevrátila výsledek včas.", finishedAt: now, updatedAt: now })
    .where(and(eq(secTestRuns.status, "running"), lt(secTestRuns.startedAt, new Date(now.getTime() - RUN_TIMEOUT_MS))));
  const mine = probe.companyId ? eq(secTestRuns.companyId, probe.companyId) : undefined;
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(secTestRuns)
      .where(and(eq(secTestRuns.status, "queued"), eq(secTestRuns.source, "probe"), or(eq(secTestRuns.probeId, probe.id), and(isNull(secTestRuns.probeId), mine))))
      .orderBy(asc(secTestRuns.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!job) return null;
    // rozsah se ověří znovu – mohl mezitím vypršet nebo se změnit
    const [scope] = await tx.select().from(secTestScopes).where(eq(secTestScopes.id, job.scopeId));
    const why = scope ? scopeProblem(scope, job.testId as SecTestId, job.targets) : "rozsah neexistuje";
    if (why) {
      await tx.update(secTestRuns).set({ status: "failed", error: `Úloha zamítnuta: ${why}`, finishedAt: now, updatedAt: now }).where(eq(secTestRuns.id, job.id));
      return null;
    }
    await tx.update(secTestRuns).set({ status: "running", probeId: probe.id, startedAt: now, updatedAt: now }).where(eq(secTestRuns.id, job.id));
    return { runId: job.id, testId: job.testId, targets: job.targets, ports: job.ports };
  });
}

/* ---------- rozsahy ---------- */

export function scopeStatus(s: typeof secTestScopes.$inferSelect): SecTestScopeDto["status"] {
  if (!s.approvedAt) return "draft";
  return s.validTo < today() ? "expired" : "approved";
}

/** Proč nelze test spustit (rozsah neschválen, neplatný, kategorie, cíl mimo rozsah), nebo null. */
export function scopeProblem(s: typeof secTestScopes.$inferSelect, testId: SecTestId, targets: string[], day = today()): string | null {
  if (!s.approvedAt) return "rozsah není schválen";
  if (day < s.validFrom || day > s.validTo) return `rozsah platí ${s.validFrom} – ${s.validTo}`;
  const def = secTestDef(testId);
  if (!def) return "neznámý test";
  if (!s.categories.includes(def.category)) return "kategorie testu není v rozsahu povolena";
  for (const t of targets) {
    if (def.target === "url" && !/^https?:\/\//i.test(t)) return `${t}: test potřebuje URL (https://…)`;
    if (def.target === "host" && /^https?:\/\//i.test(t)) return `${t}: test potřebuje IP nebo název serveru, ne URL`;
    const why = scopeAllows({ targets: s.targets, exclusions: s.exclusions }, t);
    if (why) return `${t}: ${why}`;
  }
  return null;
}

export async function scopeDtos(db: Db, where: SQL | undefined): Promise<SecTestScopeDto[]> {
  const creator = alias(users, "creator");
  const approver = alias(users, "approver");
  const rows = await db
    .select({ s: secTestScopes, createdByName: creator.displayName, approvedByName: approver.displayName })
    .from(secTestScopes)
    .leftJoin(creator, eq(creator.id, secTestScopes.createdById))
    .leftJoin(approver, eq(approver.id, secTestScopes.approvedById))
    .where(where)
    .orderBy(desc(secTestScopes.createdAt));
  const n = rows.length ? await db.select({ id: secTestRuns.scopeId, n: count() }).from(secTestRuns).where(inArray(secTestRuns.scopeId, rows.map((r) => r.s.id))).groupBy(secTestRuns.scopeId) : [];
  return rows.map(({ s, createdByName, approvedByName }) => ({
    id: s.id,
    companyId: s.companyId,
    name: s.name,
    targets: s.targets,
    exclusions: s.exclusions,
    validFrom: s.validFrom,
    validTo: s.validTo,
    authorization: s.authorization,
    categories: s.categories as SecTestScopeDto["categories"],
    note: s.note,
    status: scopeStatus(s),
    createdByName,
    approvedByName,
    approvedAt: s.approvedAt?.toISOString() ?? null,
    runs: n.find((x) => x.id === s.id)?.n ?? 0,
  }));
}

/* ---------- běhy ---------- */

export async function runDtos(db: Db, where: SQL | undefined, limit = 200): Promise<SecTestRunDto[]> {
  const rows = await db
    .select({ r: secTestRuns, scopeName: secTestScopes.name, probeName: connections.name, requestedByName: users.displayName })
    .from(secTestRuns)
    .innerJoin(secTestScopes, eq(secTestScopes.id, secTestRuns.scopeId))
    .leftJoin(connections, eq(connections.id, secTestRuns.probeId))
    .leftJoin(users, eq(users.id, secTestRuns.requestedById))
    .where(where)
    .orderBy(desc(secTestRuns.createdAt))
    .limit(limit);
  return rows.map(({ r, scopeName, probeName, requestedByName }) => ({
    id: r.id,
    batchId: r.batchId,
    parentRunId: r.parentRunId,
    companyId: r.companyId,
    scopeId: r.scopeId,
    scopeName,
    testId: r.testId as SecTestId,
    targets: r.targets,
    ports: r.ports,
    source: r.source as "probe" | "import",
    probeId: r.probeId,
    probeName,
    status: r.status as SecTestRunDto["status"],
    error: r.error,
    requestedByName,
    createdAt: r.createdAt.toISOString(),
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    stats: { findings: 0, critical: 0, high: 0, medium: 0, low: 0, hosts: 0, ...(r.stats as Record<string, number>) },
    facts: r.facts as unknown as SecTestHostFacts[],
    warnings: r.warnings,
    summary: (r.summary as unknown as SecTestRunDto["summary"]) ?? null,
    retestFindingId: r.retestFindingId,
  }));
}

const findingKey = (testId: string, code: string, host: string, port: number | null) => sha256([testId, code, host.toLowerCase(), port ?? ""].join("\u0000")).slice(0, 64);
const MAX_OUTPUT = 512 * 1024;

/**
 * Zpracování výsledku (sonda i import): parsování, zápis nálezů (upsert podle klíče), uzavření nálezů téhož testu
 * na otestovaných hostitelích, které ve výstupu chybí; běh dostane statistiky a skutečnosti.
 */
export async function completeRun(db: Db, run: typeof secTestRuns.$inferSelect, outputs: { target: string; label?: string; stdout: string; stderr?: string; exitCode?: number | null; port?: number | null; durationMs?: number }[], error: string | null, now = new Date()) {
  const testId = run.testId as SecTestId;
  const parts: SecTestParseResult[] = outputs.map((o) => parseSecTest(testId, o.stdout, o.target));
  const res = mergeResults(parts);
  for (const o of outputs) if (o.exitCode && !o.stdout.trim()) res.warnings.push(`${o.target}: nástroj skončil s kódem ${o.exitCode} ${(o.stderr ?? "").slice(-300)}`.trim());
  const match = await hostMatcher(db, run.companyId);
  const keys: string[] = [];
  for (const f of res.findings) {
    const key = findingKey(testId, f.code, f.host, f.port);
    keys.push(key);
    const asset = match(f.host, /^\d+\.\d+\.\d+\.\d+$/.test(f.host) ? f.host : null);
    const values = { runId: run.id, testId, code: f.code.slice(0, 200), severity: f.severity, title: f.title.slice(0, 500), detail: f.detail, host: f.host.slice(0, 300), port: f.port, evidence: f.evidence, assetId: asset?.id ?? null, lastSeenAt: now, updatedAt: now };
    await db
      .insert(secTestFindings)
      .values({ companyId: run.companyId, key, ...values, firstSeenAt: now })
      .onConflictDoUpdate({
        target: [secTestFindings.companyId, secTestFindings.key],
        // opravený nález, který se znovu objevil, se znovu otevře; přijatý / falešný zůstává
        // ruční přiřazení k aktivu se nepřepíše prázdnou shodou
        set: { ...values, assetId: asset?.id ?? sql`${secTestFindings.assetId}`, status: sql`case when ${secTestFindings.status} = 'fixed' or (${secTestFindings.status} = 'accepted' and ${secTestFindings.acceptedUntil} < current_date) then 'open' else ${secTestFindings.status} end`, fixedAt: sql`case when ${secTestFindings.status} = 'fixed' then null else ${secTestFindings.fixedAt} end` },
      });
  }
  if (res.tested.length && !error) {
    const fixed = await db
      .update(secTestFindings)
      .set({ status: "fixed", fixedAt: now, updatedAt: now })
      .where(
        and(
          eq(secTestFindings.companyId, run.companyId),
          eq(secTestFindings.testId, testId),
          eq(secTestFindings.status, "open"),
          inArray(sql`lower(${secTestFindings.host})`, res.tested.map((h) => h.toLowerCase())),
          keys.length ? sql`${secTestFindings.key} not in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})` : undefined,
        ),
      )
      .returning({ id: secTestFindings.id });
    // úkoly na odstranění opravených nálezů se uzavřou samy (v1.60)
    await closeFindingTasks(db, fixed.map((x) => x.id), "done", `Oprava ověřena opakovaným testem ${now.toISOString().slice(0, 10)}.`, now);
  }
  const by = (s: string) => res.findings.filter((f) => f.severity === s).length;
  const stats = { findings: res.findings.length, critical: by("critical"), high: by("high"), medium: by("medium"), low: by("low"), hosts: res.tested.length };
  let budget = MAX_OUTPUT;
  const kept = outputs.map((o) => {
    const out = o.stdout.slice(0, Math.max(0, budget));
    budget -= out.length;
    return { target: o.target || o.label || "", port: o.port ?? null, exitCode: o.exitCode ?? null, durationMs: o.durationMs ?? 0, stdout: out, truncated: out.length < o.stdout.length, stderr: (o.stderr ?? "").slice(-2000) };
  });
  await db
    .update(secTestRuns)
    .set({ status: error ? "failed" : "done", error, finishedAt: now, updatedAt: now, targets: run.targets.length ? run.targets : res.tested.slice(0, 256), outputs: kept, facts: res.facts as unknown as Record<string, unknown>[], stats, warnings: res.warnings })
    .where(eq(secTestRuns.id, run.id));
  if (!error && run.batchId && !run.parentRunId && (testId === "net.ports" || testId === "net.services")) await queueFollowUps(db, run, res.facts as SecTestHostFacts[]);
  if (!error && run.batchId) {
    const [b] = await db.select({ autoTasks: secTestBatches.autoTasks, by: secTestBatches.requestedById }).from(secTestBatches).where(eq(secTestBatches.id, run.batchId));
    if (b?.autoTasks) await autoTasksForRun(db, run.id, b.by, now);
  }
  // ověření opravy (v1.63): nález trvá → úkol zpět odpovědné osobě
  if (run.retestFindingId) await afterRetest(db, run, error, now);
  if (!error) {
    // CVE z nálezů do evidence zranitelností a TLS cíle do inventáře certifikátů (v1.67, ADR-160)
    await mirrorSecTestCves(db, run.companyId, undefined, now);
    if (testId === "tls.testssl") {
      const seen = new Map<string, { host: string; port: number | null }>();
      const add = (host: string, port: number | null) => host && !seen.has(`${host.toLowerCase()}:${port ?? 443}`) && seen.set(`${host.toLowerCase()}:${port ?? 443}`, { host, port });
      for (const f of res.findings) add(f.host, f.port);
      const outPort = outputs.find((o) => o.port)?.port ?? null;
      for (const h of res.tested) if (![...seen.values()].some((x) => x.host.toLowerCase() === h.toLowerCase())) add(h, outPort);
      const targets = [...seen.values()].map((x) => ({ ...x, assetId: match(x.host, /^\d+\.\d+\.\d+\.\d+$/.test(x.host) ? x.host : null)?.id ?? null }));
      await registerTlsEndpoints(db, run.companyId, targets);
    }
    // semafor aktiv zahrnuje otevřené nálezy testů (v1.65)
    await recomputeHealth(db, now).catch(() => undefined);
  }
  return stats;
}

/* ---------- sady (v1.56.1) ---------- */

type ScopeRow = typeof secTestScopes.$inferSelect;

/** Rozvine sadu: test × cíle (převod hostitel ↔ URL), ověří rozsah. Vrací běhy k založení, nebo důvod odmítnutí. */
export function planBatch(scope: ScopeRow, testIds: SecTestId[], targets: string[], ports: number[], portsAll = false) {
  const runs: { testId: SecTestId; targets: string[]; ports: number[] }[] = [];
  const skipped: string[] = [];
  for (const testId of [...new Set(testIds)]) {
    const def = secTestDef(testId)!;
    const conv = [...new Set(targets.map((x) => targetFor(def, x)).filter((x): x is string => !!x))];
    if (!conv.length) {
      skipped.push(`${testId}: žádný vhodný cíl`);
      continue;
    }
    const why = scopeProblem(scope, testId, conv);
    if (why) return { error: `${testId}: ${why}`, runs: [], skipped };
    // porty platí pro verze služeb; u navazujícího testu z nálezu i pro TLS / SSH (port nálezu)
    runs.push({ testId, targets: conv, ports: testId === "net.services" || (portsAll && def.target === "host" && def.ports.length > 0 && !testId.startsWith("win.")) ? ports : [] });
  }
  if (!runs.length) return { error: "Žádný z vybraných testů nemá vhodný cíl (webové testy potřebují server nebo URL, ne rozsah CIDR).", runs, skipped };
  return { error: null, runs, skipped };
}

export async function createBatch(db: Db, scope: ScopeRow, i: { name: string; testIds: SecTestId[]; targets: string[]; ports: number[]; probeId: string | null; autoFollow: boolean; autoAi: boolean; autoTasks?: boolean; portsAll?: boolean; scheduleId?: string | null }, userId: string | null) {
  const plan = planBatch(scope, i.testIds, i.targets, i.ports, i.portsAll);
  if (plan.error) return { error: plan.error, batchId: null, skipped: plan.skipped };
  return db.transaction(async (tx) => {
    const [b] = await tx
      .insert(secTestBatches)
      .values({ companyId: scope.companyId, scopeId: scope.id, name: i.name || plan.runs.map((r) => r.testId).join(", ").slice(0, 200), autoFollow: i.autoFollow, autoAi: i.autoAi, autoTasks: i.autoTasks ?? false, scheduleId: i.scheduleId ?? null, requestedById: userId })
      .returning({ id: secTestBatches.id });
    // průzkum portů první – navazující testy z něj se zařadí za ostatní
    const order = (x: SecTestId) => (x.startsWith("net.") ? 0 : 1);
    const base = Date.now();
    let k = 0;
    for (const r of [...plan.runs].sort((a, b2) => order(a.testId) - order(b2.testId)))
      await tx.insert(secTestRuns).values({ companyId: scope.companyId, scopeId: scope.id, batchId: b!.id, testId: r.testId, targets: r.targets, ports: r.ports, source: "probe", probeId: i.probeId, requestedById: userId, createdAt: new Date(base + k++) });
    return { error: null, batchId: b!.id, skipped: plan.skipped };
  });
}

/** Navazující testy po průzkumu portů: podle služeb, jen v rozsahu, bez duplicit v sadě; stejná sonda. */
export async function queueFollowUps(db: Db, run: typeof secTestRuns.$inferSelect, facts: SecTestHostFacts[]) {
  const [b] = await db.select().from(secTestBatches).where(eq(secTestBatches.id, run.batchId!));
  if (!b?.autoFollow) return 0;
  const [scope] = await db.select().from(secTestScopes).where(eq(secTestScopes.id, run.scopeId));
  if (!scope) return 0;
  const existing = await db.select({ testId: secTestRuns.testId, targets: secTestRuns.targets }).from(secTestRuns).where(eq(secTestRuns.batchId, b.id));
  const done = new Set(existing.flatMap((r) => r.targets.map((t) => `${r.testId}|${t}`)));
  const groups = new Map<string, { testId: SecTestId; targets: string[]; ports: number[] }>();
  for (const f of followUpsFromFacts(facts)) {
    if (done.has(`${f.testId}|${f.target}`) || scopeProblem(scope, f.testId, [f.target])) continue;
    const k = `${f.testId}|${[...f.ports].sort().join(",")}`;
    const g = groups.get(k) ?? { testId: f.testId, targets: [], ports: f.ports };
    g.targets.push(f.target);
    groups.set(k, g);
  }
  for (const g of groups.values())
    await db.insert(secTestRuns).values({ companyId: run.companyId, scopeId: run.scopeId, batchId: b.id, parentRunId: run.id, testId: g.testId, targets: g.targets.slice(0, 256), ports: g.ports, source: "probe", probeId: run.probeId, requestedById: run.requestedById });
  return groups.size;
}

/**
 * Rozdíl sady z plánu proti předchozímu stavu (v1.63): nově zjištěné nálezy (první výskyt v běhu sady)
 * a opravené (uzavřené testem téhož druhu během sady). Počítá se při čtení.
 */
async function batchDiffs(db: Db, batches: (typeof secTestBatches.$inferSelect)[], runs: SecTestRunDto[]) {
  const out = new Map<string, { new: number; fixed: number; newHigh: number }>();
  for (const b of batches) {
    const rs = runs.filter((r) => r.batchId === b.id);
    if (!rs.length) continue;
    const ids = rs.map((r) => r.id);
    const tests = [...new Set(rs.map((r) => r.testId))];
    const end = rs.reduce((m, r) => (r.finishedAt && r.finishedAt > m ? r.finishedAt : m), b.createdAt.toISOString());
    const [n] = await db
      .select({ n: sql<number>`count(*)::int`, h: sql<number>`count(*) filter (where ${secTestFindings.severity} in ('critical','high'))::int` })
      .from(secTestFindings)
      .where(and(inArray(secTestFindings.runId, ids), sql`${secTestFindings.firstSeenAt} >= ${b.createdAt.toISOString()}`));
    const [fx] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(secTestFindings)
      .where(and(eq(secTestFindings.companyId, b.companyId), inArray(secTestFindings.testId, tests), eq(secTestFindings.status, "fixed"), sql`${secTestFindings.fixedAt} >= ${b.createdAt.toISOString()}`, sql`${secTestFindings.fixedAt} <= ${end}`));
    out.set(b.id, { new: n!.n, newHigh: n!.h, fixed: fx!.n });
  }
  return out;
}

export async function batchDtos(db: Db, where: SQL | undefined, limit = 100): Promise<SecTestBatchDto[]> {
  const rows = await db
    .select({ b: secTestBatches, scopeName: secTestScopes.name, requestedByName: users.displayName })
    .from(secTestBatches)
    .innerJoin(secTestScopes, eq(secTestScopes.id, secTestBatches.scopeId))
    .leftJoin(users, eq(users.id, secTestBatches.requestedById))
    .where(where)
    .orderBy(desc(secTestBatches.createdAt))
    .limit(limit);
  if (!rows.length) return [];
  const runs = await runDtos(db, inArray(secTestRuns.batchId, rows.map((r) => r.b.id)), 5000);
  const diffs = await batchDiffs(db, rows.filter((r) => r.b.scheduleId).map((r) => r.b), runs);
  return rows.map(({ b, scopeName, requestedByName }) => {
    const rs = runs.filter((r) => r.batchId === b.id).sort((a, c) => a.createdAt.localeCompare(c.createdAt));
    const sum = (k: "findings" | "critical" | "high" | "medium" | "low") => rs.reduce((a, r) => a + (r.stats[k] ?? 0), 0);
    return {
      id: b.id,
      companyId: b.companyId,
      scopeId: b.scopeId,
      scopeName,
      name: b.name,
      autoFollow: b.autoFollow,
      autoAi: b.autoAi,
      autoTasks: b.autoTasks,
      scheduleId: b.scheduleId,
      diff: diffs.get(b.id) ?? null,
      requestedByName,
      createdAt: b.createdAt.toISOString(),
      runs: rs,
      status: rs.some((r) => r.status === "queued" || r.status === "running") ? "running" : "done",
      stats: { findings: sum("findings"), critical: sum("critical"), high: sum("high"), medium: sum("medium"), low: sum("low") },
      summary: (b.summary as unknown as SecTestBatchDto["summary"]) ?? null,
    };
  });
}

/** Ruční přiřazení nálezu (a volitelně všech nálezů stejného cíle) k aktivu; adresu si aktivum může zapamatovat. */
export async function assignFinding(db: Db, f: typeof secTestFindings.$inferSelect, assetId: string | null, sameHost: boolean, remember: boolean) {
  const where = sameHost ? and(eq(secTestFindings.companyId, f.companyId), sql`lower(${secTestFindings.host}) = ${f.host.toLowerCase()}`) : eq(secTestFindings.id, f.id);
  const r = await db.update(secTestFindings).set({ assetId, updatedAt: new Date() }).where(where).returning({ id: secTestFindings.id });
  await reassignFindingTasks(db, { findingIds: r.map((x) => x.id) });
  await mirrorSecTestCves(db, f.companyId, r.map((x) => x.id));
  let remembered = false;
  if (assetId && remember) {
    const [a] = await db.select({ ips: assets.ipAddresses, hostname: assets.hostname, fqdn: assets.fqdn }).from(assets).where(eq(assets.id, assetId));
    const host = f.host.toLowerCase();
    if (a && /^\d+\.\d+\.\d+\.\d+$/.test(host) && !a.ips.includes(host)) {
      await db.update(assets).set({ ipAddresses: [...a.ips, host], updatedAt: new Date() }).where(eq(assets.id, assetId));
      remembered = true;
    } else if (a && !/^\d+\.\d+\.\d+\.\d+$/.test(host) && !a.fqdn && a.hostname?.toLowerCase() !== host) {
      await db.update(assets).set({ fqdn: host, updatedAt: new Date() }).where(eq(assets.id, assetId));
      remembered = true;
    }
  }
  return { updated: r.length, remembered };
}

export async function ingestProbeResult(db: Db, probe: typeof connections.$inferSelect, input: ReturnType<typeof ProbeResultInput.parse>) {
  const [run] = await db.select().from(secTestRuns).where(eq(secTestRuns.id, input.runId));
  if (!run || run.probeId !== probe.id || run.status !== "running") return null;
  return completeRun(db, run, input.outputs, input.error);
}

/* ---------- nálezy ---------- */

const acceptor = alias(users, "sectest_acceptor");

export async function findingDtos(db: Db, where: SQL | undefined, limit = 2000): Promise<SecTestFindingDto[]> {
  const rows = await db
    .select({ f: secTestFindings, assetName: assets.name, accBy: acceptor.displayName, o: assets.ownerUserId, t: assets.technicalOwnerUserId, d: assets.technicalDeputyUserId, cCode: controls.code, cName: controls.name })
    .from(secTestFindings)
    .leftJoin(assets, eq(assets.id, secTestFindings.assetId))
    .leftJoin(controls, eq(controls.id, secTestFindings.controlId))
    .leftJoin(acceptor, eq(acceptor.id, secTestFindings.acceptedById))
    .where(where)
    .orderBy(sql`case ${secTestFindings.severity} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end`, desc(secTestFindings.lastSeenAt))
    .limit(limit);
  const taskOf = await findingTasks(db, rows.map((r) => r.f.id));
  // odpovědné osoby z evidence aktiva (v1.62)
  const uids = [...new Set(rows.flatMap((r) => [r.o, r.t, r.d]).filter((x): x is string => !!x))];
  const uname = new Map(uids.length ? (await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, uids))).map((u) => [u.id, u.name]) : []);
  const nm = (id: string | null) => (id ? (uname.get(id) ?? null) : null);
  return rows.map(({ f, assetName, accBy, o, t, d, cCode, cName }) => ({
    id: f.id,
    companyId: f.companyId,
    testId: f.testId as SecTestId,
    code: f.code,
    severity: f.severity as SecTestFindingDto["severity"],
    title: f.title,
    detail: f.detail,
    host: f.host,
    port: f.port,
    evidence: f.evidence,
    assetId: f.assetId,
    assetName,
    status: f.status as SecTestFindingDto["status"],
    note: f.note,
    firstSeenAt: f.firstSeenAt.toISOString(),
    lastSeenAt: f.lastSeenAt.toISOString(),
    runId: f.runId,
    advice: (f.advice as unknown as SecTestFindingDto["advice"]) ?? null,
    task: taskOf.get(f.id) ?? null,
    owners: f.assetId ? { business: nm(o), technical: nm(t), deputy: nm(d) } : null,
    fixedAt: f.fixedAt?.toISOString() ?? null,
    acceptedByName: f.status === "accepted" ? accBy : null,
    acceptedAt: f.status === "accepted" ? (f.acceptedAt?.toISOString() ?? null) : null,
    acceptedUntil: f.status === "accepted" ? f.acceptedUntil : null,
    controlId: f.controlId,
    controlLabel: cName ? (cCode ? `${cCode} ${cName}` : cName) : null,
  }));
}

/** Porty dostupné ze sítě podle posledních testů (pro detail serveru ze sběrače). */
export async function reachablePorts(db: Db, companyId: string, ips: string[]) {
  if (!ips.length) return [];
  const runs = await db
    .select({ facts: secTestRuns.facts, at: secTestRuns.finishedAt })
    .from(secTestRuns)
    .where(and(eq(secTestRuns.companyId, companyId), eq(secTestRuns.status, "done"), inArray(secTestRuns.testId, ["net.ports", "net.services"])))
    .orderBy(desc(secTestRuns.finishedAt))
    .limit(30);
  for (const r of runs) {
    const f = (r.facts as unknown as SecTestHostFacts[]).find((x) => ips.includes(x.host));
    if (f) return f.ports.map((p) => ({ ...p, at: r.at?.toISOString() ?? null }));
  }
  return [];
}

/* ---------- instalátor sondy ---------- */

const shq = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

/** POSIX sh: uživatel contix-probe, skript, konfigurace, služba systemd (smyčka), první dotaz; `--uninstall` vše odebere. */
export function buildProbeInstaller(o: { name: string; url: string; token: string; script: string; caPem: string; generatedAt?: Date }) {
  const ca = o.caPem.trim();
  if (o.script.includes("\nCONTIX_PY_END") || ca.includes("CONTIX_CA_END")) throw new Error("neplatný obsah instalátoru");
  return `#!/bin/sh
# CONTIX ${CONTIX_VERSION} – instalátor sondy bezpečnostních testů (ADR-153)
# Sonda: ${o.name.replace(/[\r\n]/g, " ")} · vygenerováno ${(o.generatedAt ?? new Date()).toISOString()}
# Použití:   sudo sh install-contix-probe.sh             instalace / aktualizace
#            sudo sh install-contix-probe.sh --keep      soubor se po instalaci nesmaže
#            sudo sh install-contix-probe.sh --contix-ip 10.0.0.5   IP serveru CONTIX, když ho DNS nezná (zápis do /etc/hosts)
#            sudo sh install-contix-probe.sh --dns 10.0.0.1         DNS server, když sonda žádný nemá
#            sudo sh install-contix-probe.sh --uninstall odebrání sondy
# Soubor obsahuje token sondy – po instalaci se sám smaže.
set -eu
CONTIX_URL=${shq(o.url)}
BIN=/usr/local/sbin/contix-probe.py
ENVF=/etc/contix-probe.env
CAF=/etc/contix-probe-ca.pem
UNIT=/etc/systemd/system/contix-probe.service
KEEP=0
CONTIX_IP=""
DNS_IP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP=1 ;;
    --contix-ip | --dns)
      [ $# -ge 2 ] || { echo "Chybí IP adresa za $1" >&2; exit 2; }
      if [ "$1" = --dns ]; then DNS_IP="$2"; else CONTIX_IP="$2"; fi
      shift ;;
    --uninstall)
      [ "$(id -u)" = 0 ] || { echo "Spusťte jako root: sudo sh $0 --uninstall" >&2; exit 1; }
      systemctl disable --now contix-probe.service 2>/dev/null || true
      rm -f "$BIN" "$ENVF" "$CAF" "$UNIT"
      systemctl daemon-reload 2>/dev/null || true
      echo "Sonda CONTIX odebrána (uživatel contix-probe zůstává: userdel contix-probe)."
      exit 0 ;;
    *) echo "Neznámý parametr: $1 (povoleno --keep, --contix-ip IP, --dns IP, --uninstall)" >&2; exit 2 ;;
  esac
  shift
done
is_ip() { echo "$1" | grep -Eq '^[0-9]{1,3}(\\.[0-9]{1,3}){3}$'; }
[ "$(id -u)" = 0 ] || { echo "Spusťte jako root: sudo sh $0" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "Chybí python3." >&2; exit 1; }
command -v systemctl >/dev/null 2>&1 || { echo "Chybí systemd (systemctl)." >&2; exit 1; }

id contix-probe >/dev/null 2>&1 || useradd --system --home-dir /var/lib/contix-probe --create-home --shell /usr/sbin/nologin contix-probe
echo "• uživatel: contix-probe (bez práv roota)"

umask 022
cat > "$BIN.tmp" <<'CONTIX_PY_END'
${o.script.replace(/\s+$/, "")}
CONTIX_PY_END
chmod 0755 "$BIN.tmp" && mv -f "$BIN.tmp" "$BIN"
echo "• sonda: $BIN"
${
  ca
    ? `cat > "$CAF" <<'CONTIX_CA_END'
${ca}
CONTIX_CA_END
chmod 0644 "$CAF"
CA_LINE="CONTIX_CA=$CAF"`
    : `rm -f "$CAF"
CA_LINE=""`
}

umask 077
{
  echo "CONTIX_URL=$CONTIX_URL"
  echo ${shq(`CONTIX_TOKEN=${o.token}`)}
  [ -z "$CA_LINE" ] || echo "$CA_LINE"
} > "$ENVF"
chown root:contix-probe "$ENVF"
chmod 0640 "$ENVF"
echo "• konfigurace: $ENVF"

umask 022
cat > "$UNIT" <<'CONTIX_UNIT_END'
[Unit]
Description=CONTIX sonda bezpečnostních testů
After=network-online.target
Wants=network-online.target

[Service]
User=contix-probe
Group=contix-probe
ExecStart=/usr/bin/python3 /usr/local/sbin/contix-probe.py --loop
Restart=always
RestartSec=30
NoNewPrivileges=yes
# UDP skeny (nmap -sU --privileged) potřebují raw sockety – jen tyto dvě schopnosti, nic dalšího
AmbientCapabilities=CAP_NET_RAW CAP_NET_ADMIN
CapabilityBoundingSet=CAP_NET_RAW CAP_NET_ADMIN
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=/var/lib/contix-probe

[Install]
WantedBy=multi-user.target
CONTIX_UNIT_END
systemctl daemon-reload
echo "• služba: contix-probe.service"

# ---- kontrola sítě (v1.95, ADR-189): DNS, jméno CONTIXu, port, internet ----
HOST=$(echo "$CONTIX_URL" | sed -E 's#^[a-zA-Z]+://([^/:]+).*#\\1#')
PORT=$(echo "$CONTIX_URL" | sed -nE 's#^[a-zA-Z]+://[^/:]+:([0-9]+).*#\\1#p')
[ -n "$PORT" ] || { case "$CONTIX_URL" in http:*) PORT=80 ;; *) PORT=443 ;; esac; }
ask() { # otázka → odpověď z terminálu (prázdná bez terminálu)
  a=""
  if [ -t 0 ]; then printf '%s' "$1" >&2; read -r a || a=""; fi
  echo "$a"
}
echo "• kontrola sítě:"
if ! grep -Eq '^[[:space:]]*nameserver[[:space:]]' /etc/resolv.conf 2>/dev/null; then
  echo "  ! sonda nemá nastavený žádný DNS server (/etc/resolv.conf)"
  [ -n "$DNS_IP" ] || DNS_IP=$(ask "  Zadejte DNS server (interní DNS, nebo 8.8.8.8; Enter = přeskočit): ")
  if [ -n "$DNS_IP" ] && is_ip "$DNS_IP"; then
    echo "nameserver $DNS_IP" >> /etc/resolv.conf
    # dhcpcd soubor při obnově adresy přepíše – .head zůstane
    if [ -f /etc/dhcpcd.conf ] || command -v dhcpcd >/dev/null 2>&1; then echo "nameserver $DNS_IP" >> /etc/resolv.conf.head; fi
    echo "  ✔ DNS server $DNS_IP nastaven"
  elif [ -n "$DNS_IP" ]; then
    echo "  ! „$DNS_IP“ není IP adresa – DNS nenastaveno"
  fi
fi
if is_ip "$HOST"; then
  echo "  CONTIX: $HOST (IP adresa)"
elif getent hosts "$HOST" >/dev/null 2>&1; then
  echo "  ✔ DNS: $HOST → $(getent hosts "$HOST" | awk '{print $1; exit}')"
else
  echo "  ! jméno $HOST nejde přeložit na IP adresu"
  [ -n "$CONTIX_IP" ] || CONTIX_IP=$(ask "  Zadejte IP adresu serveru CONTIX (zapíše se do /etc/hosts; Enter = přeskočit): ")
  if [ -n "$CONTIX_IP" ] && is_ip "$CONTIX_IP"; then
    sed -i "/[[:space:]]$HOST\$/d" /etc/hosts
    echo "$CONTIX_IP $HOST" >> /etc/hosts
    echo "  ✔ /etc/hosts: $CONTIX_IP $HOST"
  else
    echo "  → Založte DNS záznam pro $HOST, nebo spusťte znovu s --contix-ip <IP serveru CONTIX>."
  fi
fi
if python3 -c "import socket,sys; socket.create_connection((sys.argv[1], int(sys.argv[2])), 5).close()" "$HOST" "$PORT" 2>/dev/null; then
  echo "  ✔ spojení na $HOST:$PORT"
else
  echo "  ! na $HOST:$PORT se nejde připojit – zkontrolujte firewall mezi sondou a CONTIXem"
fi
if getent hosts deb.debian.org >/dev/null 2>&1; then
  echo "  ✔ internet / DNS pro instalaci balíčků"
else
  echo "  – veřejná jména nejdou přeložit (instalace balíčků z internetu nepůjde; pro testy to nevadí)"
fi

echo "• dostupné nástroje:"
sudo -u contix-probe /usr/bin/python3 "$BIN" --tools || true
MISSING=""
command -v nmap >/dev/null 2>&1 || MISSING="$MISSING nmap"
{ command -v testssl >/dev/null 2>&1 || command -v testssl.sh >/dev/null 2>&1; } || MISSING="$MISSING testssl.sh"
command -v ssh-audit >/dev/null 2>&1 || MISSING="$MISSING ssh-audit"
command -v nikto >/dev/null 2>&1 || MISSING="$MISSING nikto"
[ -z "$MISSING" ] || echo "  → chybějící nástroje doinstalujete: sudo apt update && sudo apt install -y$MISSING"
echo "• spojení s CONTIXem…"
if sudo -u contix-probe /usr/bin/python3 "$BIN" --once; then
  systemctl enable --now contix-probe.service >/dev/null 2>&1
  systemctl restart contix-probe.service
  echo "Hotovo – sonda běží a čeká na úlohy (Bezpečnostní testy → Spustit test)."
  if [ "$KEEP" = 0 ] && [ -f "$0" ]; then rm -f -- "$0" && echo "Instalátor smazán (obsahoval token)."; fi
else
  echo "Spojení selhalo – opravte příčinu a spusťte: sudo -u contix-probe python3 $BIN --once" >&2
  exit 1
fi
`;
}

export { today as sectestToday };
