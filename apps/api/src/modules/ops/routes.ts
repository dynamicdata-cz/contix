import { legislationStatus } from "../legislation/service";
import { converterHealth } from "../policies/convert";
import { BACKUP_MAX_AGE_HOURS, CONTIX_VERSION, backupLevel, type BackupRunDto, type OpsCheck, type SystemStatusDto, type Translate } from "@contix/shared";
import { timingSafeEqual } from "node:crypto";
import { count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { requirePerm } from "../../auth/middleware";
import { getSettings, type AppEnv } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { aiSuggestions, assets, backupRuns, companies, incidents, policyFiles, docIndexState, identitySources, risks, users } from "../../db/schema";
import { getAiSettings } from "../ai/service";
import { getAlertSettings } from "../alerts/routes";
import { getNotificationSettings } from "../notifications/service";
import { getCompanies } from "../../auth/scope";
import { recordIndexStatus } from "../search/records";
import { socSlaItems } from "../soc/service";
import { intelStatus } from "../vulnerabilities/intel";
import { CS_T, tFor } from "../i18n/service";
import { INSTANCE_ID, STARTED_AT, leaseHolder, schedulerState } from "./lease";

/* ============================================================
 * Provoz: stav systému (administrace), evidence záloh, metriky pro Prometheus.
 * ============================================================ */

const backupDto = (b: typeof backupRuns.$inferSelect): BackupRunDto => ({
  id: b.id,
  startedAt: b.startedAt.toISOString(),
  finishedAt: b.finishedAt?.toISOString() ?? null,
  status: b.status === "ok" ? "ok" : "error",
  file: b.file,
  sizeBytes: b.sizeBytes,
  encrypted: b.encrypted,
  host: b.host,
  message: b.message,
});

async function dbInfo(db: Db) {
  const t0 = performance.now();
  try {
    const [row] = (await db.execute(sql`select version() as v, pg_database_size(current_database())::bigint as size`)) as unknown as { v: string; size: string }[];
    const latencyMs = Math.round(performance.now() - t0);
    let migrations: number | null = null;
    try {
      const [m] = (await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`)) as unknown as { n: number }[];
      migrations = m?.n ?? null;
    } catch {
      migrations = null;
    }
    return { ok: true, version: row?.v?.split(" ").slice(0, 2).join(" ") ?? null, sizeBytes: row ? Number(row.size) : null, migrations, latencyMs };
  } catch {
    return { ok: false, version: null, sizeBytes: null, migrations: null, latencyMs: null };
  }
}

export async function systemStatus(db: Db, config: Config, t: Translate = CS_T): Promise<SystemStatusDto> {
  const now = new Date();
  const database = await dbInfo(db);
  const [sched, lease, notif, alerts, ai, lastRows, lastOk, counts] = await Promise.all([
    schedulerState(db),
    leaseHolder(db, "scheduler"),
    getNotificationSettings(db),
    getAlertSettings(db),
    getAiSettings(db),
    db.select().from(backupRuns).orderBy(desc(backupRuns.startedAt)).limit(1),
    db.select().from(backupRuns).where(eq(backupRuns.status, "ok")).orderBy(desc(backupRuns.startedAt)).limit(1),
    Promise.all([
      db.select({ n: count() }).from(users).where(eq(users.isActive, true)),
      db.select({ n: count() }).from(companies),
      db.select({ n: count() }).from(assets),
      db.select({ n: count() }).from(risks),
      db.select({ n: count() }).from(incidents).where(inArray(incidents.status, ["new", "assessing", "handling"])),
      db.select({ n: count() }).from(aiSuggestions).where(gte(aiSuggestions.createdAt, new Date(now.getTime() - 30 * 86_400_000))),
    ]),
  ]);
  const lastBackup = lastRows[0] ? backupDto(lastRows[0]) : null;
  const lastSuccessfulBackupAt = lastOk[0]?.finishedAt?.toISOString() ?? lastOk[0]?.startedAt.toISOString() ?? null;

  const checks: OpsCheck[] = [];
  checks.push({ key: "db", label: t("srv.ops.db.label"), level: database.ok ? "ok" : "error", detail: database.ok ? t("srv.ops.db.ok", { version: String(database.version), ms: String(database.latencyMs) }) : t("srv.ops.db.down") });
  const bl = backupLevel(lastSuccessfulBackupAt, now);
  checks.push({
    key: "backup",
    label: t("srv.ops.backup.label"),
    level: lastBackup?.status === "error" && bl === "ok" ? "warning" : bl,
    detail: lastSuccessfulBackupAt
      ? lastBackup?.status === "error"
        ? t("srv.ops.backup.lastFailed", { at: new Date(lastSuccessfulBackupAt).toLocaleString(t.locale), message: lastBackup.message ?? "" })
        : t("srv.ops.backup.last", { at: new Date(lastSuccessfulBackupAt).toLocaleString(t.locale) })
      : t("srv.ops.backup.none", { hours: BACKUP_MAX_AGE_HOURS }),
  });
  const schedAge = sched.lastRunAt ? (now.getTime() - new Date(sched.lastRunAt).getTime()) / 60_000 : null;
  checks.push({
    key: "scheduler",
    label: t("srv.ops.sched.label"),
    level: config.NODE_ENV === "test" ? "off" : schedAge == null ? "warning" : schedAge > 45 ? "error" : sched.lastError ? "warning" : "ok",
    detail: sched.lastRunAt
      ? t(sched.lastError ? "srv.ops.sched.lastError" : "srv.ops.sched.last", { at: new Date(sched.lastRunAt).toLocaleString(t.locale), holder: sched.holder ?? "?", error: sched.lastError ?? "" })
      : t("srv.ops.sched.never"),
  });
  checks.push({
    key: "notifications",
    label: t("srv.ops.notif.label"),
    level: !notif.emailEnabled && !notif.teamsEnabled ? "off" : notif.lastResult?.includes("chyb") ? "warning" : "ok",
    detail: !notif.emailEnabled && !notif.teamsEnabled ? t("srv.ops.off") : (notif.lastResult ?? t("srv.ops.notif.notSent")),
  });
  checks.push({ key: "alerts", label: t("srv.ops.alerts.label"), level: alerts.alertsEnabled ? "ok" : "off", detail: alerts.alertsEnabled ? (alerts.lastResult ?? t("srv.ops.alerts.notLoaded")) : t("srv.ops.off") });
  checks.push({
    key: "ai",
    label: t("srv.ops.ai.label"),
    level: !ai.enabled ? "off" : ai.lastTestResult?.startsWith("Spojení funguje") ? "ok" : "warning",
    detail: !ai.enabled ? t("srv.ops.off") : ai.lastTestResult ? `${ai.model} @ ${ai.baseUrl} · ${ai.lastTestResult}` : t("srv.ops.ai.notTested", { model: ai.model, url: ai.baseUrl }),
  });
  {
    const conv = await converterHealth(5000);
    const q = await db.select({ s: policyFiles.pdfStatus, n: count() }).from(policyFiles).where(inArray(policyFiles.pdfStatus, ["pending", "failed"])).groupBy(policyFiles.pdfStatus);
    const pending = q.find((x) => x.s === "pending")?.n ?? 0;
    const failed = q.find((x) => x.s === "failed")?.n ?? 0;
    checks.push({
      key: "converter",
      label: t("srv.ops.conv.label"),
      level: !config.CONVERTER_URL ? "off" : !conv.ok ? "error" : failed ? "warning" : "ok",
      detail: !config.CONVERTER_URL
        ? t("srv.ops.conv.off")
        : t("srv.ops.conv.detail", { state: conv.ok ? (conv.version ?? t("srv.ops.conv.running")) : t("srv.ops.conv.unavailable", { error: conv.error ?? "?" }), pending, failed }),
    });
  }
  {
    const [st] = await db
      .select({ docs: count(), errors: sql<number>`count(*) filter (where ${docIndexState.error} is not null)::int`, chunks: sql<number>`coalesce(sum(${docIndexState.chunks}), 0)::int` })
      .from(docIndexState);
    checks.push({
      key: "doc_qa",
      label: t("srv.ops.docqa.label"),
      level: !ai.enabled || !ai.docQaEnabled ? "off" : Number(st?.errors ?? 0) ? "warning" : "ok",
      detail:
        !ai.enabled || !ai.docQaEnabled
          ? t("srv.ops.docqa.off")
          : t(Number(st?.errors ?? 0) ? "srv.ops.docqa.detailErrors" : "srv.ops.docqa.detail", { model: ai.embeddingModel, docs: st?.docs ?? 0, chunks: st?.chunks ?? 0, errors: Number(st?.errors ?? 0) }),
    });
  }
  {
    const src = await db.select().from(identitySources).where(eq(identitySources.enabled, true));
    const failed = src.filter((x) => x.lastStatus === "error");
    const stale = src.filter((x) => x.syncHours > 0 && x.lastStatus !== "error" && (!x.lastSyncAt || now.getTime() - x.lastSyncAt.getTime() > (x.syncHours * 2 + 1) * 3_600_000));
    checks.push({
      key: "identity",
      label: t("srv.ops.identity.label"),
      level: !src.length ? "off" : failed.length ? "error" : stale.length ? "warning" : "ok",
      detail: !src.length
        ? t("srv.ops.identity.none")
        : failed.length
          ? t("srv.ops.error", { details: failed.map((x) => `${x.name} – ${x.lastError ?? "?"}`).join("; ").slice(0, 300) })
          : stale.length
            ? t("srv.ops.identity.stale", { names: stale.map((x) => x.name).join(", ") })
            : t("srv.ops.identity.ok", { n: src.length, at: String(src.map((x) => x.lastSyncAt?.toISOString().slice(0, 16).replace("T", " ") ?? "–").sort().at(0)) }),
    });
  }
  {
    const st = await legislationStatus(db, config, now);
    const enabled = ((await getSettings(db)).enabledModules as string[]).includes("legislation");
    const failed = st.acts.filter((a) => a.status === "error");
    checks.push({
      key: "legislation",
      label: t("srv.ops.leg.label"),
      level: !enabled || !st.acts.length ? "off" : !st.configured ? "warning" : failed.length ? "error" : st.stale.length || st.fallback.length ? "warning" : "ok",
      detail: !enabled
        ? t("srv.ops.leg.moduleOff")
        : !st.acts.length
          ? t("srv.ops.leg.noActs")
          : !st.configured
            ? t("srv.ops.leg.notConfigured")
            : failed.length
              ? t("srv.ops.error", { details: failed.map((a) => `${a.code} – ${a.error ?? "?"}`).join("; ").slice(0, 300) })
              : st.stale.length
                ? t("srv.ops.leg.stale", { codes: st.stale.map((a) => a.code).join(", ") })
                : st.fallback.length
                  ? t("srv.ops.leg.fallback", { codes: st.fallback.map((a) => a.code).join(", ") })
                : t("srv.ops.leg.ok", { source: st.source === "api" ? "REST API" : t("srv.ops.leg.sourceOpenData"), n: st.acts.length, at: String(st.acts.map((a) => a.last?.toISOString().slice(0, 16).replace("T", " ") ?? "–").sort().at(0)) }),
    });
  }
  {
    // zdroje hrozeb KEV / EPSS (ADR-049) – stáří posledního stažení / nahrání
    const mods = (await getSettings(db)).enabledModules as string[];
    const st = await intelStatus(db);
    const at = [st.kevUpdatedAt, st.epssUpdatedAt].map((x) => (x ? new Date(x).getTime() : 0));
    const ageDays = Math.max(...at.map((x) => (x ? (now.getTime() - x) / 86_400_000 : Infinity)));
    checks.push({
      key: "vuln_intel",
      label: t("srv.ops.intel.label"),
      level: !mods.includes("vulnerabilities") ? "off" : !Number.isFinite(ageDays) ? "warning" : ageDays > 7 ? "error" : ageDays > 2 || st.lastError ? "warning" : "ok",
      detail: !mods.includes("vulnerabilities")
        ? t("srv.ops.off")
        : !Number.isFinite(ageDays)
          ? t("srv.ops.intel.never", { error: st.lastError ?? "—" })
          : t(st.lastError ? "srv.ops.intel.lastError" : "srv.ops.intel.ok", {
              kev: st.kevEntries,
              epss: st.epssEntries,
              kevAt: st.kevUpdatedAt ? new Date(st.kevUpdatedAt).toLocaleString(t.locale) : "—",
              epssAt: st.epssUpdatedAt ? new Date(st.epssUpdatedAt).toLocaleString(t.locale) : "—",
              error: st.lastError ?? "",
            }),
    });
    // vektory záznamů (ADR-044)
    const rec = await recordIndexStatus(db, (await getCompanies(db)).map((c) => c.id));
    const recTotal = Object.values(rec.byKind).reduce((a, k) => a + k.records, 0);
    const recIdx = Object.values(rec.byKind).reduce((a, k) => a + k.indexed, 0);
    checks.push({
      key: "records",
      label: t("srv.ops.records.label"),
      level: !rec.enabled ? "off" : rec.errors || recIdx < recTotal ? "warning" : "ok",
      detail: !rec.enabled ? t("srv.ops.off") : t("srv.ops.records.detail", { indexed: recIdx, total: recTotal, errors: rec.errors, model: rec.embeddingModel }),
    });
    // SOC: položky po lhůtě (ADR-047)
    if (mods.includes("soc")) {
      const all = (await getCompanies(db)).map((c) => c.id);
      const late = (await socSlaItems(db, all, 0, now)).filter((i) => i.urgency === "overdue").length;
      checks.push({ key: "soc", label: t("srv.ops.soc.label"), level: late ? "warning" : "ok", detail: t("srv.ops.soc.detail", { late }) });
    } else checks.push({ key: "soc", label: t("srv.ops.soc.label"), level: "off", detail: t("srv.ops.off") });
  }
  checks.push({
    key: "secret",
    label: t("srv.ops.secret.label"),
    level: config.APP_SECRET ? "ok" : config.NODE_ENV === "production" ? "error" : "warning",
    detail: config.APP_SECRET ? t("srv.ops.secret.ok") : t("srv.ops.secret.dev"),
  });

  const [u, co, a, r, inc, aiN] = counts;
  return {
    version: CONTIX_VERSION,
    nodeEnv: config.NODE_ENV,
    startedAt: STARTED_AT.toISOString(),
    uptimeSec: Math.round((now.getTime() - STARTED_AT.getTime()) / 1000),
    database,
    scheduler: { holder: lease?.holder ?? sched.holder, lastRunAt: sched.lastRunAt, lastError: sched.lastError, thisInstance: (lease?.holder ?? null) === INSTANCE_ID },
    lastBackup,
    lastSuccessfulBackupAt,
    checks,
    counts: { users: u[0]!.n, companies: co[0]!.n, assets: a[0]!.n, risks: r[0]!.n, openIncidents: inc[0]!.n, aiRequests30d: aiN[0]!.n },
    metricsEnabled: !!config.METRICS_TOKEN,
  };
}

export function opsRoutes(deps: { db: Db; config: Config }) {
  const { db, config } = deps;
  return new Hono<AppEnv>()
    .get("/status", requirePerm("admin:settings"), async (c) => c.json(await systemStatus(db, config, await tFor(db, c))))
    .get("/backups", requirePerm("admin:settings"), async (c) => {
      const rows = await db.select().from(backupRuns).orderBy(desc(backupRuns.startedAt)).limit(60);
      return c.json(rows.map(backupDto));
    });
}

/* ---------------- Prometheus ---------------- */

const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");

export async function metricsText(db: Db, config: Config): Promise<string> {
  const s = await systemStatus(db, config);
  const lines: string[] = [];
  const m = (name: string, help: string, type: "gauge" | "counter", value: number | null, labels?: Record<string, string>) => {
    if (value == null || Number.isNaN(value)) return;
    if (!lines.some((l) => l.startsWith(`# HELP ${name} `))) lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    const lab = labels ? `{${Object.entries(labels).map(([k, v]) => `${k}="${esc(v)}"`).join(",")}}` : "";
    lines.push(`${name}${lab} ${value}`);
  };
  m("contix_info", "Verze CONTIX", "gauge", 1, { version: s.version });
  m("contix_uptime_seconds", "Doba běhu instance API", "gauge", s.uptimeSec);
  m("contix_db_up", "Databáze odpovídá", "gauge", s.database.ok ? 1 : 0);
  m("contix_db_size_bytes", "Velikost databáze", "gauge", s.database.sizeBytes);
  m("contix_db_latency_ms", "Odezva databáze", "gauge", s.database.latencyMs);
  const ts = (v: string | null) => (v ? Math.round(new Date(v).getTime() / 1000) : null);
  m("contix_backup_last_success_timestamp_seconds", "Čas poslední úspěšné zálohy (unix)", "gauge", ts(s.lastSuccessfulBackupAt));
  m("contix_backup_last_size_bytes", "Velikost poslední zálohy", "gauge", s.lastBackup?.sizeBytes ?? null);
  m("contix_scheduler_last_run_timestamp_seconds", "Poslední běh plánovače (unix)", "gauge", ts(s.scheduler.lastRunAt));
  for (const ch of s.checks) m("contix_check_status", "Stav kontroly (0 ok, 1 varování, 2 chyba, -1 vypnuto)", "gauge", { ok: 0, warning: 1, error: 2, off: -1 }[ch.level], { check: ch.key });
  for (const [k, v] of Object.entries(s.counts)) m("contix_records", "Počty záznamů", "gauge", v, { kind: k });
  return `${lines.join("\n")}\n`;
}

/** Pomocné: ověření Bearer tokenu metrik (časově konstantní porovnání). */
export function metricsAuthorized(header: string | undefined, token: string | undefined) {
  if (!token || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

