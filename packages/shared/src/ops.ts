/* ============================================================
 * Provoz – stav systému, zálohy, plánovač, monitoring.
 * ============================================================ */

export const CONTIX_VERSION = "1.24.5";
/** Veřejný zdrojový kód (AGPL, ADR-112) – výchozí odkaz, když server nemá CONTIX_SOURCE_URL. */
export const CONTIX_DEFAULT_SOURCE_URL = "https://github.com/dynamicdata-cz/contix";
/** Licence CONTIXu (v1.15, ADR-112) – AGPL-3.0: uživatelé přes síť mají nárok na zdrojový kód (čl. 13). */
export const CONTIX_LICENSE = "AGPL-3.0-only";

/** Veřejné informace o instalaci (GET /api/health, bez přihlášení). */
export interface HealthDto {
  status: string;
  db: boolean;
  version: string;
  license: string;
  /** Odkaz na zdrojový kód této instalace (CONTIX_SOURCE_URL); null = nenastaveno. */
  sourceUrl: string | null;
  time: string;
}

/** Záloha starší než tento počet hodin = varování (denní záloha + rezerva). */
export const BACKUP_MAX_AGE_HOURS = 26;

export type OpsLevel = "ok" | "warning" | "error" | "off";

export interface BackupRunDto {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: "ok" | "error";
  file: string | null;
  sizeBytes: number | null;
  encrypted: boolean;
  host: string | null;
  message: string | null;
}

export interface OpsCheck {
  key: string;
  label: string;
  level: OpsLevel;
  detail: string;
}

export interface SystemStatusDto {
  version: string;
  nodeEnv: string;
  startedAt: string;
  uptimeSec: number;
  database: { ok: boolean; version: string | null; sizeBytes: number | null; migrations: number | null; latencyMs: number | null };
  scheduler: { holder: string | null; lastRunAt: string | null; lastError: string | null; thisInstance: boolean };
  lastBackup: BackupRunDto | null;
  lastSuccessfulBackupAt: string | null;
  checks: OpsCheck[];
  counts: Record<string, number>;
  metricsEnabled: boolean;
}

/** Úroveň stavu zálohy podle stáří poslední úspěšné zálohy. */
export function backupLevel(lastOkAt: string | null, now = new Date()): OpsLevel {
  if (!lastOkAt) return "warning";
  const h = (now.getTime() - new Date(lastOkAt).getTime()) / 3_600_000;
  return h <= BACKUP_MAX_AGE_HOURS ? "ok" : h <= BACKUP_MAX_AGE_HOURS * 3 ? "warning" : "error";
}

export const fmtBytes = (n: number | null | undefined) => {
  if (n == null) return "—";
  const u = ["B", "kB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString("cs-CZ", { maximumFractionDigits: v < 10 && i ? 1 : 0 })} ${u[i]}`;
};
