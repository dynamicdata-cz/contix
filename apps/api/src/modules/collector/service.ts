import { syncHostFindings } from "./findings";
import { recomputeHealth } from "../vulnerabilities/service";
import { COLLECTOR_TOKEN_PREFIX, CONTIX_VERSION, diffHostInventory, evaluateHardening, evaluateHost, HostInventoryInput, ROOT_COMPANY_ID, type HostDetailDto, type HostInventoryDto, type CollectorConnectionDto, type CollectorConnectionInput, type HostInventory, type HostSummaryDto } from "@contix/shared";
import { createHash, randomBytes } from "node:crypto";
import { and, count, desc, eq, inArray, max, sql, type SQL } from "drizzle-orm";
import { decrypt, encrypt } from "../../auth/crypto";
import { appSecret, type Config } from "../../config";
import type { Db } from "../../db/client";
import { assetSoftware, assetSources, assets, connections, hostInventories, hostInventoryChanges } from "../../db/schema";
import { ingestDiscovered } from "../discovery/ingest";
import type { DiscoveredAsset } from "../discovery/types";
import { reachablePorts } from "../sectests/service";

/* ============================================================
 * Sběrač ze serverů (v1.51, ADR-148): připojení typu `collector` s tokenem (v DB jen SHA-256),
 * příjem inventáře → aktivum (zdroj `collector`, párování jako discovery) + poslední inventář a nálezy shody.
 * ============================================================ */

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export function newCollectorToken() {
  const token = `${COLLECTOR_TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
  return { token, hash: sha256(token), prefix: token.slice(0, 12) };
}

/** Token šifrovaně (v1.54) – kvůli instalátoru; ověřování dál jen podle otisku. */
const tokenSecrets = (token: string, config: Config) => ({ token: encrypt(token, appSecret(config)) });

export async function saveCollector(db: Db, config: Config, id: string | null, i: CollectorConnectionInput): Promise<{ id: string; token: string | null }> {
  const values = { kind: "collector", name: i.name, enabled: i.enabled ?? true, companyId: i.companyId ?? null, updatedAt: new Date() };
  if (id) {
    await db.update(connections).set(values).where(and(eq(connections.id, id), eq(connections.kind, "collector")));
    return { id, token: null };
  }
  const t = newCollectorToken();
  const [r] = await db.insert(connections).values({ ...values, config: { tokenHash: t.hash, tokenPrefix: t.prefix }, secrets: tokenSecrets(t.token, config) }).returning({ id: connections.id });
  return { id: r!.id, token: t.token };
}

/** Nový token (starý přestane platit). */
export async function rotateCollectorToken(db: Db, config: Config, id: string): Promise<string> {
  const t = newCollectorToken();
  const [row] = await db.select().from(connections).where(and(eq(connections.id, id), eq(connections.kind, "collector")));
  if (!row) throw new Error("not found");
  await db.update(connections).set({ config: { ...(row.config as Record<string, unknown>), tokenHash: t.hash, tokenPrefix: t.prefix }, secrets: tokenSecrets(t.token, config), updatedAt: new Date() }).where(eq(connections.id, id));
  return t.token;
}

export async function collectorByToken(db: Db, token: string) {
  if (!token.startsWith(COLLECTOR_TOKEN_PREFIX)) return null;
  const [row] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.kind, "collector"), eq(connections.enabled, true), sql`${connections.config}->>'tokenHash' = ${sha256(token)}`));
  return row ?? null;
}

export async function collectorDtos(db: Db): Promise<CollectorConnectionDto[]> {
  const rows = await db.select().from(connections).where(eq(connections.kind, "collector")).orderBy(connections.createdAt);
  if (!rows.length) return [];
  const stats = await db
    .select({ id: hostInventories.connectionId, n: count(), last: max(hostInventories.collectedAt) })
    .from(hostInventories)
    .where(inArray(hostInventories.connectionId, rows.map((r) => r.id)))
    .groupBy(hostInventories.connectionId);
  return rows.map((r) => {
    const st = stats.find((x) => x.id === r.id);
    const cfg = r.config as { tokenPrefix?: string; hostsIp?: string; caPem?: string };
    return {
      id: r.id,
      kind: "collector",
      name: r.name,
      enabled: r.enabled,
      companyId: r.companyId,
      tokenPrefix: String(cfg.tokenPrefix ?? ""),
      hosts: st?.n ?? 0,
      lastReportAt: st?.last ? new Date(st.last).toISOString() : null,
      installerReady: !!r.secrets?.token,
      hostsIp: cfg.hostsIp ?? "",
      caPem: cfg.caPem ?? "",
    };
  });
}

/** Zdroj inventáře: sběrač (skript, token) nebo agent CONTIX přes koncentrátor (ADR-177). */
export type InventorySource = "collector" | "agent";

/** Záznam Discovery z inventáře serveru – stejný pro příjem i ruční založení aktiva. */
function discoveredFromInventory(conn: typeof connections.$inferSelect, inv: HostInventory, hostKey: string, source: InventorySource, createIfMissing: boolean): DiscoveredAsset {
  const companyId = conn.companyId ?? ROOT_COMPANY_ID;
  return {
    sourceType: source,
    sourceRef: hostKey,
    connectionId: conn.id,
    companyId,
    matchInCompany: !!conn.companyId,
    createIfMissing,
    name: inv.host.hostname,
    assetType: "server",
    hostname: inv.host.hostname,
    fqdn: inv.host.fqdn,
    ipAddresses: inv.host.ips,
    osName: inv.host.os,
    attributes: { [source]: { users: inv.users.length, sshKeys: inv.sshKeys.length, containers: inv.containers.length, packages: inv.packages.length, firewall: inv.firewall.tool, kernel: inv.host.kernel } },
    raw: { host: inv.host, collectorVersion: inv.collectorVersion },
    seenAt: new Date(inv.collectedAt),
  };
}

const packagesKey = (inv: HostInventory) => inv.packages.map((p) => `${p.name}=${p.version}`).sort().join("\n");

/** Balíčky z inventáře jako software aktiva (zdroj agent / sběrač) – nahradí předchozí výpis téhož zdroje. */
export async function syncInventorySoftware(db: Db, assetId: string, source: InventorySource, inv: HostInventory) {
  await db.transaction(async (tx) => {
    await tx.delete(assetSoftware).where(and(eq(assetSoftware.assetId, assetId), eq(assetSoftware.sourceType, source)));
    const seen = new Set<string>();
    const rows = inv.packages
      .filter((p) => (seen.has(`${p.name}|${p.version}`) ? false : (seen.add(`${p.name}|${p.version}`), true)))
      .map((p) => ({ assetId, name: p.name.slice(0, 300), version: p.version ? p.version.slice(0, 255) : null, vendor: null, sourceType: source }));
    for (let i = 0; i < rows.length; i += 500) await tx.insert(assetSoftware).values(rows.slice(i, i + 500));
  });
}

export const inventoryHostKey = (inv: HostInventory) => (inv.host.machineId || inv.host.hostname).toLowerCase();

/**
 * Příjem inventáře: aktivum (vytvoří / spáruje) + poslední inventář s nálezy. Agenti (`createAsset: false`) aktivum
 * nezakládají – bez jednoznačné shody zůstane server nespárovaný a správce ho založí nebo spáruje (`attachHostToAsset`).
 */
export async function ingestInventory(db: Db, conn: typeof connections.$inferSelect, inv: HostInventory, opts: { source?: InventorySource; createAsset?: boolean } = {}) {
  const hostKey = inventoryHostKey(inv);
  const companyId = conn.companyId ?? ROOT_COMPANY_ID;
  const findings = evaluateHost(inv);
  const [prev] = await db.select({ id: hostInventories.id, data: hostInventories.data, at: hostInventories.collectedAt, assetId: hostInventories.assetId }).from(hostInventories).where(and(eq(hostInventories.connectionId, conn.id), eq(hostInventories.hostKey, hostKey)));
  const r = await ingestDiscovered(db, discoveredFromInventory(conn, inv, hostKey, opts.source ?? "collector", opts.createAsset ?? true), companyId);
  // ručně spárovaný server (zdroj zapsán při spárování) zůstává u svého aktiva
  const assetId = r.action === "created" || r.action === "updated" ? r.assetId : (prev?.assetId ?? null);
  const [asset] = assetId ? await db.select({ companyId: assets.companyId }).from(assets).where(eq(assets.id, assetId)) : [];
  const values = { connectionId: conn.id, companyId: asset?.companyId ?? companyId, assetId, hostKey, hostname: inv.host.hostname, collectedAt: new Date(inv.collectedAt), data: inv as unknown as Record<string, unknown>, findings: findings as unknown as Record<string, unknown>[], updatedAt: new Date() };
  const [saved] = await db.insert(hostInventories).values(values).onConflictDoUpdate({ target: [hostInventories.connectionId, hostInventories.hostKey], set: values }).returning({ id: hostInventories.id });
  // změny od minulého inventáře (v1.55) – jen novější hlášení, jen když se něco změnilo; nejvýš 200 záznamů na server
  const old = prev ? normalizeInventory(prev.data) : null;
  if (prev && old && values.collectedAt > prev.at) {
    const changes = diffHostInventory(old, inv);
    if (changes.length) {
      await db.insert(hostInventoryChanges).values({ inventoryId: saved!.id, collectedAt: values.collectedAt, changes: changes as unknown as Record<string, unknown>[] });
      await db.execute(sql`delete from host_inventory_changes where inventory_id = ${saved!.id} and id not in (select id from host_inventory_changes where inventory_id = ${saved!.id} order by collected_at desc limit 200)`);
    }
  }
  // software aktiva z balíčků (v1.88, ADR-183) – infoservis a vyhledávání podle softwaru; přepis jen při změně
  if (assetId && (!prev || values.collectedAt >= prev.at) && (!old || prev?.assetId !== assetId || packagesKey(old) !== packagesKey(inv)))
    await syncInventorySoftware(db, assetId, opts.source ?? "collector", inv);
  // nálezy s životním cyklem a úkoly (v1.65) – jen z nejnovějšího hlášení
  if (!prev || values.collectedAt >= prev.at) {
    await syncHostFindings(db, { id: saved!.id, companyId: values.companyId, assetId }, findings);
    if (assetId) await recomputeHealth(db).catch(() => undefined);
  }
  return { inventoryId: saved!.id, assetId, action: r.action, findings: findings.length, high: findings.filter((f) => f.severity === "high").length };
}

/**
 * Ruční přiřazení serveru k aktivu (ADR-177): `assetId` = spárovat s existujícím aktivem, null = založit aktivum
 * z inventáře (bez shody nové, při jednoznačné shodě spáruje). Konflikt = vyhodí chybu `ambiguous`.
 */
export async function attachHostToAsset(db: Db, inventoryId: string, assetId: string | null): Promise<{ assetId: string; action: "linked" | "created" | "updated" } | { error: "not_found" | "ambiguous" }> {
  const [row] = await db.select({ h: hostInventories, conn: connections }).from(hostInventories).innerJoin(connections, eq(connections.id, hostInventories.connectionId)).where(eq(hostInventories.id, inventoryId));
  const inv = row ? normalizeInventory(row.h.data) : null;
  if (!row || !inv) return { error: "not_found" };
  const source: InventorySource = row.conn.kind === "concentrator" ? "agent" : "collector";
  let target = assetId;
  let action: "linked" | "created" | "updated" = "linked";
  if (target) {
    await db
      .insert(assetSources)
      .values({ assetId: target, sourceType: source, sourceRef: row.h.hostKey, connectionId: row.conn.id, raw: { host: inv.host }, lastSyncedAt: new Date() })
      .onConflictDoUpdate({ target: [assetSources.sourceType, assetSources.sourceRef, assetSources.connectionId], set: { assetId: target, lastSyncedAt: new Date(), updatedAt: new Date() } });
  } else {
    const r = await ingestDiscovered(db, discoveredFromInventory(row.conn, inv, row.h.hostKey, source, true), row.conn.companyId ?? ROOT_COMPANY_ID);
    if (r.action === "conflict" || r.action === "unmatched") return { error: "ambiguous" };
    target = r.assetId;
    action = r.action;
  }
  const [asset] = await db.select({ companyId: assets.companyId }).from(assets).where(eq(assets.id, target));
  if (!asset) return { error: "not_found" };
  await db.update(hostInventories).set({ assetId: target, companyId: asset.companyId, updatedAt: new Date() }).where(eq(hostInventories.id, inventoryId));
  await syncHostFindings(db, { id: inventoryId, companyId: asset.companyId, assetId: target }, evaluateHost(inv));
  await syncInventorySoftware(db, target, source, inv);
  await recomputeHealth(db).catch(() => undefined);
  return { assetId: target, action };
}

/** Uložený inventář doplněný o výchozí hodnoty (starší sběrač neposílá všechna pole). */
export function normalizeInventory(data: unknown): HostInventory | null {
  const p = HostInventoryInput.safeParse(data);
  return p.success ? p.data : null;
}

export function hostDto(h: typeof hostInventories.$inferSelect, connectionName: string, assetName: string | null): HostInventoryDto {
  const data = normalizeInventory(h.data) ?? (h.data as unknown as HostInventory);
  return {
    id: h.id,
    connectionId: h.connectionId,
    connectionName,
    assetId: h.assetId,
    assetName,
    companyId: h.companyId,
    hostname: h.hostname,
    collectedAt: h.collectedAt.toISOString(),
    findings: evaluateHost(data),
    data,
  };
}

export async function hostDetail(db: Db, id: string): Promise<HostDetailDto | null> {
  const [r] = await db
    .select({ h: hostInventories, conn: connections.name, assetName: assets.name })
    .from(hostInventories)
    .innerJoin(connections, eq(connections.id, hostInventories.connectionId))
    .leftJoin(assets, eq(assets.id, hostInventories.assetId))
    .where(eq(hostInventories.id, id));
  if (!r) return null;
  const ch = await db.select().from(hostInventoryChanges).where(eq(hostInventoryChanges.inventoryId, id)).orderBy(desc(hostInventoryChanges.collectedAt)).limit(200);
  const dto = hostDto(r.h, r.conn, r.assetName);
  const reachable = (await reachablePorts(db, r.h.companyId, dto.data.host.ips)).map((p) => ({ port: p.port, proto: p.proto, service: p.service, at: p.at }));
  return { ...dto, reachable, changes: ch.map((c) => ({ collectedAt: c.collectedAt.toISOString(), changes: c.changes as unknown as HostDetailDto["changes"][number]["changes"] })) };
}

export async function hostSummaries(db: Db, where: SQL | undefined): Promise<HostSummaryDto[]> {
  const rows = await db
    .select({ h: hostInventories, conn: connections.name })
    .from(hostInventories)
    .innerJoin(connections, eq(connections.id, hostInventories.connectionId))
    .where(where)
    .orderBy(desc(hostInventories.collectedAt))
    .limit(2000);
  return rows.map(({ h, conn }) => {
    const norm = normalizeInventory(h.data);
    const d = norm ?? (h.data as unknown as HostInventory);
    const f = norm ? evaluateHost(d) : (h.findings as unknown as { severity: string }[]);
    return {
      id: h.id,
      connectionId: h.connectionId,
      assetId: h.assetId,
      hardening: norm ? evaluateHardening(d).score : null,
      hostname: h.hostname,
      os: d.host?.os ?? null,
      collectorVersion: d.collectorVersion ?? "",
      securityUpdates: d.system?.securityUpdates ?? null,
      connectionName: conn,
      collectedAt: h.collectedAt.toISOString(),
      users: d.users?.length ?? 0,
      sshKeys: d.sshKeys?.length ?? 0,
      containers: d.containers?.length ?? 0,
      high: f.filter((x) => x.severity === "high").length,
      medium: f.filter((x) => x.severity === "medium").length,
      low: f.filter((x) => x.severity === "low").length,
    };
  });
}

/* ---------- Instalátor (v1.54): jeden shellový skript na server ---------- */

/** Uložený token v čitelné podobě (null = token z doby před v1.54 nebo změněný APP_SECRET). */
export function collectorToken(row: typeof connections.$inferSelect, config: Config): string | null {
  try {
    return row.secrets?.token ? decrypt(row.secrets.token, appSecret(config)) : null;
  } catch {
    return null;
  }
}

const shq = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

/**
 * Skript POSIX sh: ověří root a python3, (volitelně) doplní /etc/hosts, nainstaluje sběrač, CA, konfiguraci a cron,
 * spustí první běh a smaže se (obsahuje token). `--uninstall` vše odebere. Obsah je idempotentní – opakované spuštění přepíše.
 */
export function buildCollectorInstaller(o: { name: string; url: string; token: string; script: string; hostsIp: string; caPem: string; everyHours: number; generatedAt?: Date }) {
  const host = new URL(o.url).hostname;
  const hours = o.everyHours >= 24 ? "3" : `*/${o.everyHours}`;
  const ca = o.caPem.trim();
  if (o.script.includes("\nCONTIX_PY_END") || ca.includes("CONTIX_CA_END")) throw new Error("neplatný obsah instalátoru");
  return `#!/bin/sh
# CONTIX ${CONTIX_VERSION} – instalátor sběrače ze serverů (ADR-148/151)
# Připojení: ${o.name.replace(/[\r\n]/g, " ")} · vygenerováno ${(o.generatedAt ?? new Date()).toISOString()}
# Použití:   sudo sh install-contix-collect.sh            instalace / aktualizace + první běh
#            sudo sh install-contix-collect.sh --keep     totéž, ale soubor se po instalaci nesmaže
#            sudo sh install-contix-collect.sh --uninstall odebrání sběrače
# Soubor obsahuje token sběrače – po instalaci se sám smaže; neposílejte ho e-mailem ani do chatu.
set -eu
CONTIX_URL=${shq(o.url)}
CONTIX_HOST=${shq(host)}
HOSTS_IP=${shq(o.hostsIp)}
BIN=/usr/local/sbin/contix-collect.py
ENVF=/etc/contix-collect.env
CAF=/etc/contix-ca.pem
CRON=/etc/cron.d/contix-collect
KEEP=0
case "\${1:-}" in
  --keep) KEEP=1 ;;
  --uninstall)
    [ "$(id -u)" = 0 ] || { echo "Spusťte jako root: sudo sh $0 --uninstall" >&2; exit 1; }
    rm -f "$BIN" "$ENVF" "$CAF" "$CRON"
    echo "Sběrač CONTIX odebrán (záznam v /etc/hosts a aktivum v CONTIXu zůstávají)."
    exit 0 ;;
  "") ;;
  *) echo "Neznámý parametr: $1 (povoleno --keep, --uninstall)" >&2; exit 2 ;;
esac
[ "$(id -u)" = 0 ] || { echo "Spusťte jako root: sudo sh $0" >&2; exit 1; }
if ! command -v python3 >/dev/null 2>&1; then
  echo "Chybí python3 (3.6+). Nainstalujte: apt install python3 | dnf install python3 | zypper install python3" >&2
  exit 1
fi

if [ -n "$HOSTS_IP" ] && ! getent hosts "$CONTIX_HOST" >/dev/null 2>&1; then
  printf '%s %s\\n' "$HOSTS_IP" "$CONTIX_HOST" >> /etc/hosts
  echo "• /etc/hosts: $HOSTS_IP $CONTIX_HOST"
fi

umask 022
cat > "$BIN.tmp" <<'CONTIX_PY_END'
${o.script.replace(/\s+$/, "")}
CONTIX_PY_END
chmod 0755 "$BIN.tmp" && mv -f "$BIN.tmp" "$BIN"
echo "• sběrač: $BIN"
${
  ca
    ? `cat > "$CAF" <<'CONTIX_CA_END'
${ca}
CONTIX_CA_END
chmod 0644 "$CAF"
echo "• certifikát CA: $CAF"
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
chmod 0600 "$ENVF"
echo "• konfigurace: $ENVF"

MIN=$(( $(od -An -N2 -tu2 /dev/urandom | tr -d ' ') % 60 ))
umask 022
echo "$MIN ${hours} * * * root $BIN >/dev/null 2>&1" > "$CRON"
echo "• plán: $CRON (každých ${o.everyHours} h, minuta $MIN)"

echo "• první běh…"
if "$BIN"; then
  echo "Hotovo – server je v CONTIXu (Discovery & import → Servery ze sběrače)."
  if [ "$KEEP" = 0 ] && [ -f "$0" ]; then rm -f -- "$0" && echo "Instalátor smazán (obsahoval token)."; fi
else
  echo "První běh selhal – instalace zůstává, opravte příčinu a spusťte: sudo $BIN" >&2
  exit 1
fi
`;
}
