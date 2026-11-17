import { connectionCovers, type WazuhConnectionDto, type WazuhConnectionInput } from "@contix/shared";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { decrypt, encrypt } from "../../auth/crypto";
import { appSecret, type Config } from "../../config";
import type { Db } from "../../db/client";
import { alertSuggestions, appSettings, assetSources, assets, connections, discoveryRuns } from "../../db/schema";
import type { WazuhConfig } from "../connectors/config";

/* ============================================================
 * Připojení k Wazuhu (v1.49, ADR-146): víc instancí, každá s rozsahem (společnost / skupina + mapování
 * skupin agentů) a schopnostmi (inventář, zranitelnosti, SCA, alerty, reakce). Tajemství jen šifrovaně.
 * ID agenta je jedinečné jen v rámci jednoho Wazuhu → každý odkaz na agenta nese id připojení.
 * ============================================================ */

export interface WazuhConn extends WazuhConfig {
  id: string;
  name: string;
  primary: boolean;
  companyId: string | null;
  groupMap: { group: string; companyId: string }[];
  alertsEnabled: boolean;
  alertMinLevel: number;
  alertsIndexPattern: string;
  arUser: string;
  arPassword: string | null;
  state: WazuhState;
}

export interface WazuhState {
  alertsLastSyncAt?: string | null;
  alertsLastResult?: string | null;
}

interface StoredConfig {
  url: string;
  user: string;
  verifyTls: boolean;
  includePackages: boolean;
  vulnEnabled: boolean;
  indexerUrl: string;
  indexerUser: string;
  indexerVerifyTls: boolean;
  indexPattern: string;
  autoSyncHours: number;
  alertsEnabled: boolean;
  alertMinLevel: number;
  alertsIndexPattern: string;
  arUser: string;
}

const DEFAULTS: StoredConfig = {
  url: "",
  user: "",
  verifyTls: true,
  includePackages: true,
  vulnEnabled: true,
  indexerUrl: "",
  indexerUser: "",
  indexerVerifyTls: true,
  indexPattern: "wazuh-states-vulnerabilities-*",
  autoSyncHours: 24,
  alertsEnabled: false,
  alertMinLevel: 10,
  alertsIndexPattern: "wazuh-alerts-*",
  arUser: "",
};

type Row = typeof connections.$inferSelect;

function toConn(r: Row, config: Config, primary: boolean): WazuhConn {
  const c = { ...DEFAULTS, ...(r.config as Partial<StoredConfig>) };
  const dec = (v?: string) => {
    try {
      return v ? decrypt(v, appSecret(config)) : null;
    } catch {
      return null; // změněný APP_SECRET → heslo je potřeba zadat znovu
    }
  };
  return {
    source: "db",
    id: r.id,
    name: r.name,
    primary,
    enabled: r.enabled,
    companyId: r.companyId,
    groupMap: r.groupMap ?? [],
    ...c,
    password: dec(r.secrets.password),
    indexerPassword: dec(r.secrets.indexerPassword),
    arPassword: dec(r.secrets.arPassword),
    state: (r.state ?? {}) as WazuhState,
  };
}

/** Všechna připojení k Wazuhu (nejstarší = primární). */
export async function listWazuh(db: Db, config: Config, opts: { enabledOnly?: boolean } = {}): Promise<WazuhConn[]> {
  const rows = await db.select().from(connections).where(eq(connections.kind, "wazuh")).orderBy(asc(connections.createdAt), asc(connections.id));
  return rows.map((r, i) => toConn(r, config, i === 0)).filter((c) => !opts.enabledOnly || c.enabled);
}

export async function getWazuh(db: Db, config: Config, id: string): Promise<WazuhConn | null> {
  return (await listWazuh(db, config)).find((c) => c.id === id) ?? null;
}

export async function primaryWazuh(db: Db, config: Config): Promise<WazuhConn | null> {
  return (await listWazuh(db, config))[0] ?? null;
}

export const wazuhApiReady = (w: Pick<WazuhConn, "enabled" | "url" | "user" | "password">) => w.enabled && !!w.url && !!w.user && !!w.password;
export const wazuhIndexerReady = (w: Pick<WazuhConn, "enabled" | "indexerUrl" | "indexerUser" | "indexerPassword">) => w.enabled && !!w.indexerUrl && !!w.indexerUser && !!w.indexerPassword;

/** Parametry indexeru alertů daného připojení. */
export const alertsIndexer = (w: WazuhConn) => ({ url: w.indexerUrl, user: w.indexerUser, password: w.indexerPassword!, verifyTls: w.indexerVerifyTls, indexPattern: w.alertsIndexPattern });
export const alertsIndexPath = (w: WazuhConn) => `/${encodeURIComponent(w.alertsIndexPattern).replace(/%2A/g, "*")}/_search`;

/** Připojení s indexerem, která pokrývají společnost (bez společnosti = všechna). */
export async function indexersFor(db: Db, config: Config, companyId?: string | null): Promise<WazuhConn[]> {
  return (await listWazuh(db, config, { enabledOnly: true })).filter((w) => wazuhIndexerReady(w) && (!companyId || connectionCovers(w, companyId)));
}

/** Aktivum k agentovi daného připojení. */
export async function assetForAgent(db: Db, connectionId: string | null, agentId: string) {
  const [a] = await db
    .select({ id: assets.id, companyId: assets.companyId })
    .from(assetSources)
    .innerJoin(assets, eq(assets.id, assetSources.assetId))
    .where(and(eq(assetSources.sourceType, "wazuh"), eq(assetSources.sourceRef, agentId), connectionId ? eq(assetSources.connectionId, connectionId) : isNull(assetSources.connectionId)));
  return a ?? null;
}

/** Uloží připojení (nové / úprava). Prázdné heslo = ponechat uložené. Vrací id. */
export async function saveWazuh(db: Db, config: Config, id: string | null, i: WazuhConnectionInput): Promise<string> {
  const prev = id ? (await db.select().from(connections).where(eq(connections.id, id)))[0] : undefined;
  const enc = (v: string | undefined, key: string) => (v ? encrypt(v, appSecret(config)) : (prev?.secrets[key] ?? undefined));
  const secrets = Object.fromEntries(
    Object.entries({ password: enc(i.password, "password"), indexerPassword: enc(i.indexerPassword, "indexerPassword"), arPassword: enc(i.arPassword, "arPassword") }).filter(([, v]) => !!v),
  ) as Record<string, string>;
  const cfg: StoredConfig = {
    url: i.url.replace(/\/+$/, ""),
    user: i.user,
    verifyTls: i.verifyTls ?? true,
    includePackages: i.includePackages ?? true,
    vulnEnabled: i.vulnEnabled ?? true,
    indexerUrl: (i.indexerUrl ?? "").replace(/\/+$/, ""),
    indexerUser: i.indexerUser ?? "",
    indexerVerifyTls: i.indexerVerifyTls ?? true,
    indexPattern: i.indexPattern ?? DEFAULTS.indexPattern,
    autoSyncHours: i.autoSyncHours ?? 24,
    alertsEnabled: i.alertsEnabled ?? false,
    alertMinLevel: i.alertMinLevel ?? 10,
    alertsIndexPattern: i.alertsIndexPattern ?? DEFAULTS.alertsIndexPattern,
    arUser: i.arUser ?? "",
  };
  const values = { kind: "wazuh", name: i.name, enabled: i.enabled ?? true, companyId: i.companyId ?? null, config: cfg as unknown as Record<string, unknown>, secrets, groupMap: i.companyId ? [] : (i.groupMap ?? []), updatedAt: new Date() };
  if (prev) {
    await db.update(connections).set(values).where(eq(connections.id, prev.id));
    return prev.id;
  }
  const [r] = await db.insert(connections).values(values).returning({ id: connections.id });
  return r!.id;
}

export async function setWazuhState(db: Db, id: string, patch: WazuhState) {
  await db
    .update(connections)
    .set({ state: sql`${connections.state} || ${JSON.stringify(patch)}::jsonb` })
    .where(eq(connections.id, id));
}

/** Pole pro formulář (bez tajemství) + provozní údaje. */
export async function wazuhDtos(db: Db, config: Config): Promise<WazuhConnectionDto[]> {
  const list = await listWazuh(db, config);
  if (!list.length) return [];
  const ids = list.map((w) => w.id);
  const [agents, runs] = await Promise.all([
    db.select({ id: assetSources.connectionId, n: count() }).from(assetSources).where(inArray(assetSources.connectionId, ids)).groupBy(assetSources.connectionId),
    db
      .selectDistinctOn([discoveryRuns.connectionId], { id: discoveryRuns.connectionId, at: discoveryRuns.createdAt, status: discoveryRuns.status })
      .from(discoveryRuns)
      .where(inArray(discoveryRuns.connectionId, ids))
      .orderBy(discoveryRuns.connectionId, desc(discoveryRuns.createdAt)),
  ]);
  return list.map((w) => {
    const run = runs.find((r) => r.id === w.id);
    return {
      id: w.id,
      kind: "wazuh",
      name: w.name,
      primary: w.primary,
      enabled: w.enabled,
      companyId: w.companyId,
      groupMap: w.groupMap,
      url: w.url,
      user: w.user,
      hasPassword: !!w.password,
      verifyTls: w.verifyTls,
      includePackages: w.includePackages,
      vulnEnabled: w.vulnEnabled,
      indexerUrl: w.indexerUrl,
      indexerUser: w.indexerUser,
      hasIndexerPassword: !!w.indexerPassword,
      indexerVerifyTls: w.indexerVerifyTls,
      indexPattern: w.indexPattern,
      autoSyncHours: w.autoSyncHours,
      alertsEnabled: w.alertsEnabled,
      alertMinLevel: w.alertMinLevel,
      alertsIndexPattern: w.alertsIndexPattern,
      arUser: w.arUser,
      hasArPassword: !!w.arPassword,
      agents: agents.find((a) => a.id === w.id)?.n ?? 0,
      lastSyncAt: run?.at.toISOString() ?? null,
      lastSyncStatus: run?.status ?? null,
      lastAlertSyncAt: w.state.alertsLastSyncAt ?? null,
      lastAlertResult: w.state.alertsLastResult ?? null,
    };
  });
}

const MIGRATED_KEY = "connections.migrated";

/**
 * Převod jediného Wazuhu (v1.48 a starší) na připojení – jednou, při startu API: nastavení z Administrace → Konektory
 * (jinak z .env), nastavení alertů, a existujícím vazbám agentů, během discovery a alertům se doplní id připojení.
 */
export async function ensureWazuhConnections(db: Db, config: Config) {
  const [done] = await db.select().from(appSettings).where(eq(appSettings.key, MIGRATED_KEY));
  if (done) return null;
  const [existing] = await db.select({ id: connections.id }).from(connections).where(eq(connections.kind, "wazuh")).limit(1);
  let id: string | null = existing?.id ?? null;
  if (!id) {
    const [w] = await db.select().from(appSettings).where(eq(appSettings.key, "connector.wazuh"));
    const [al] = await db.select().from(appSettings).where(eq(appSettings.key, "alerts.wazuh"));
    const a = (al?.value ?? {}) as { alertsEnabled?: boolean; alertMinLevel?: number; alertsIndexPattern?: string; lastSyncAt?: string | null; lastResult?: string | null };
    const alerts = { alertsEnabled: a.alertsEnabled ?? false, alertMinLevel: a.alertMinLevel ?? 10, alertsIndexPattern: a.alertsIndexPattern ?? DEFAULTS.alertsIndexPattern };
    const state = { alertsLastSyncAt: a.lastSyncAt ?? null, alertsLastResult: a.lastResult ?? null };
    if (w) {
      const v = w.value as Record<string, unknown> & { passwordEnc?: string | null; indexerPasswordEnc?: string | null };
      const { passwordEnc, indexerPasswordEnc, enabled, ...rest } = v;
      const secrets = Object.fromEntries(Object.entries({ password: passwordEnc, indexerPassword: indexerPasswordEnc }).filter(([, x]) => !!x)) as Record<string, string>;
      const [r] = await db
        .insert(connections)
        .values({ kind: "wazuh", name: "Wazuh", enabled: enabled !== false, config: { ...DEFAULTS, ...rest, indexerVerifyTls: rest.indexerVerifyTls ?? rest.verifyTls ?? true, ...alerts }, secrets, state })
        .returning({ id: connections.id });
      id = r!.id;
    } else if (config.WAZUH_API_URL && config.WAZUH_API_USER && config.WAZUH_API_PASSWORD) {
      const [r] = await db
        .insert(connections)
        .values({
          kind: "wazuh",
          name: "Wazuh",
          config: { ...DEFAULTS, url: config.WAZUH_API_URL.replace(/\/+$/, ""), user: config.WAZUH_API_USER, verifyTls: config.WAZUH_VERIFY_TLS, ...alerts },
          secrets: { password: encrypt(config.WAZUH_API_PASSWORD, appSecret(config)) },
          state,
        })
        .returning({ id: connections.id });
      id = r!.id;
    }
  }
  if (id) {
    await db.update(assetSources).set({ connectionId: id }).where(and(eq(assetSources.sourceType, "wazuh"), isNull(assetSources.connectionId)));
    await db.update(discoveryRuns).set({ connectionId: id }).where(and(eq(discoveryRuns.connector, "wazuh"), isNull(discoveryRuns.connectionId)));
    // klíč skupiny alertů nese připojení (stejné pravidlo a ID agenta v jiném Wazuhu = jiný alert)
    await db
      .update(alertSuggestions)
      .set({ connectionId: id, groupKey: sql`left(${id} || ':' || ${alertSuggestions.groupKey}, 200)` })
      .where(and(eq(alertSuggestions.source, "wazuh"), isNull(alertSuggestions.connectionId), sql`${alertSuggestions.groupKey} ~ '^[0-9]+:'`));
  }
  await db.insert(appSettings).values({ key: MIGRATED_KEY, value: { at: new Date().toISOString(), connectionId: id } }).onConflictDoNothing();
  return id;
}
