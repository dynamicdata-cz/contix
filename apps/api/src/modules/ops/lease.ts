import { hostname } from "node:os";
import { eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { appSettings } from "../../db/schema";

/* ============================================================
 * Zámek plánovače pro více instancí API (ADR-016).
 * Místo pg_advisory_lock (vázaný na spojení – s poolem nespolehlivý) se používá „lease“ v app_settings:
 * atomický INSERT … ON CONFLICT DO UPDATE … WHERE (vlastník = já OR lease vypršel).
 * ============================================================ */

/** Identita této instance API (host:pid:náhodný suffix). */
export const INSTANCE_ID = `${hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;
export const STARTED_AT = new Date();

const leaseKey = (name: string) => `lease:${name}`;

/** Získá nebo prodlouží lease; true = tato instance smí úlohu spustit. */
export async function acquireLease(db: Db, name: string, ttlMs: number, holder = INSTANCE_ID): Promise<boolean> {
  const until = new Date(Date.now() + ttlMs).toISOString();
  const value = JSON.stringify({ holder, until });
  const rows = await db.execute(sql`
    insert into app_settings (key, value, updated_at)
    values (${leaseKey(name)}, ${value}::jsonb, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()
    where app_settings.value->>'holder' = ${holder} or (app_settings.value->>'until')::timestamptz < now()
    returning key`);
  return rows.length > 0;
}

export async function releaseLease(db: Db, name: string, holder = INSTANCE_ID) {
  await db.execute(sql`delete from app_settings where key = ${leaseKey(name)} and value->>'holder' = ${holder}`);
}

export async function leaseHolder(db: Db, name: string): Promise<{ holder: string; until: string } | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, leaseKey(name)));
  return (row?.value as { holder: string; until: string } | undefined) ?? null;
}

/* ---------------- stav plánovače ---------------- */

const STATE_KEY = "ops.scheduler";
export interface SchedulerState {
  lastRunAt: string | null;
  lastError: string | null;
  holder: string | null;
}

export async function recordSchedulerRun(db: Db, error: string | null) {
  const v: SchedulerState = { lastRunAt: new Date().toISOString(), lastError: error, holder: INSTANCE_ID };
  await db
    .insert(appSettings)
    .values({ key: STATE_KEY, value: v })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: v, updatedAt: new Date() } });
}

export async function schedulerState(db: Db): Promise<SchedulerState> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, STATE_KEY));
  return { lastRunAt: null, lastError: null, holder: null, ...((row?.value as Partial<SchedulerState>) ?? {}) };
}
