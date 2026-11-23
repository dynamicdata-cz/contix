import { MONITORING_INFO, WAZUH_STALE_DAYS, type MonitoringCode } from "@contix/shared";
import { and, eq, inArray, lt, ne, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../../db/client";
import { assets, connections, monitoringFindings } from "../../db/schema";
import { wazuhAgents } from "./wazuhAgents";

/* ============================================================
 * Nálezy monitoringu (v1.96, ADR-190): agent Wazuhu bez spojení déle než 7 dní (server = vysoká závažnost,
 * jinak střední) a agent se starší verzí než manager (nízká). Počítá se ze stavu poslední synchronizace Wazuhu;
 * spouští se po synchronizaci a pravidelně plánovačem (doba bez spojení roste i bez synchronizace).
 * Nález, jehož příčina pominula, se uzavře jako opravený; přijatý (výjimka) zůstane do svého termínu.
 * ============================================================ */


export async function syncMonitoringFindings(db: Db, now = new Date()) {
  const conns = await db.select({ id: connections.id }).from(connections).where(and(eq(connections.kind, "wazuh"), eq(connections.enabled, true)));
  const ids = conns.map((c) => c.id);
  const res = { opened: 0, fixed: 0, reopened: 0 };
  // vypnutá / smazaná připojení: jejich nálezy se uzavřou
  const offClose = await db
    .update(monitoringFindings)
    .set({ status: "fixed", fixedAt: now, updatedAt: now })
    .where(and(eq(monitoringFindings.status, "open"), sql`${monitoringFindings.code} like 'wazuh\\_%'`, ids.length ? sql`(${monitoringFindings.connectionId} is null or ${monitoringFindings.connectionId} not in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}))` : undefined))
    .returning({ id: monitoringFindings.id });
  res.fixed += offClose.length;
  if (!ids.length) return res;
  const agents = await wazuhAgents(db, ids, undefined, now);
  const assetIds = [...new Set([...agents.values()].flatMap((a) => a.items.map((i) => i.asset?.id)).filter((x): x is string => !!x))];
  const meta = assetIds.length ? await db.select({ id: assets.id, companyId: assets.companyId, assetType: assets.assetType }).from(assets).where(inArray(assets.id, assetIds)) : [];
  const am = new Map(meta.map((m) => [m.id, m]));
  const desired: MonitoringDesired[] = [];
  for (const [cid, r] of agents)
    for (const a of r.items) {
      const m = a.asset ? am.get(a.asset.id) : undefined;
      if (!m || a.state === "removed") continue;
      const base = { companyId: m.companyId, connectionId: cid, assetId: m.id, key: `${cid}:${a.agentId}`.slice(0, 120), subject: a.name.slice(0, 500) };
      if (a.state === "disconnected" && (a.offlineDays === null || a.offlineDays >= WAZUH_STALE_DAYS))
        desired.push({
          ...base,
          code: "wazuh_agent_stale",
          severity: m.assetType === "server" ? "high" : "medium",
          detail: `${MONITORING_INFO.wazuh_agent_stale.title}: ${a.name}${a.ip ? ` (${a.ip})` : ""} – poslední spojení ${a.lastKeepAlive?.slice(0, 10) ?? "nikdy"}${a.offlineDays !== null ? `, ${a.offlineDays} dní` : ""}.`,
        });
      if (a.outdated && r.managerVersion)
        desired.push({ ...base, code: "wazuh_agent_outdated", severity: "low", detail: `${a.name}: agent ${a.version ?? "?"}, manager ${r.managerVersion}.` });
    }
  const r = await applyMonitoringFindings(db, desired, and(sql`${monitoringFindings.code} like 'wazuh\\_%'`, or(inArray(monitoringFindings.connectionId, ids), sql`${monitoringFindings.connectionId} is null`))!, now);
  return { opened: res.opened + r.opened, fixed: res.fixed + r.fixed, reopened: r.reopened };
}

export interface MonitoringDesired {
  companyId: string;
  connectionId: string | null;
  assetId: string | null;
  key: string;
  code: string;
  severity: string;
  subject: string;
  detail: string;
}

/**
 * Společný životní cyklus nálezů monitoringu: požadované nálezy založí / obnoví (opravený nebo výjimka po termínu se
 * znovu otevře), ostatní otevřené a přijaté v rozsahu `scope` (druh nálezů, společnosti) uzavře jako opravené.
 */
export async function applyMonitoringFindings(db: Db, desired: MonitoringDesired[], scope: SQL, now = new Date()) {
  const res = { opened: 0, fixed: 0, reopened: 0 };
  const today = now.toISOString().slice(0, 10);
  for (const d of desired) {
    const [cur] = await db.select({ id: monitoringFindings.id, status: monitoringFindings.status, acceptedUntil: monitoringFindings.acceptedUntil }).from(monitoringFindings).where(and(eq(monitoringFindings.key, d.key), eq(monitoringFindings.code, d.code)));
    if (!cur) {
      await db.insert(monitoringFindings).values({ ...d, status: "open", firstSeenAt: now, lastSeenAt: now });
      res.opened++;
      continue;
    }
    // opravený znovu vznikl, nebo výjimce uplynul termín → znovu otevřít
    const reopen = cur.status === "fixed" || (cur.status === "accepted" && !!cur.acceptedUntil && cur.acceptedUntil < today);
    await db
      .update(monitoringFindings)
      .set({ companyId: d.companyId, assetId: d.assetId, severity: d.severity, subject: d.subject, detail: d.detail, lastSeenAt: now, updatedAt: now, ...(reopen ? { status: "open", fixedAt: null, ...(cur.status === "fixed" ? { firstSeenAt: now } : {}) } : {}) })
      .where(eq(monitoringFindings.id, cur.id));
    if (reopen) res.reopened++;
  }
  // nálezy, jejichž příčina pominula
  const gone = await db
    .update(monitoringFindings)
    .set({ status: "fixed", fixedAt: now, updatedAt: now })
    .where(and(inArray(monitoringFindings.status, ["open", "accepted"]), lt(monitoringFindings.lastSeenAt, now), scope))
    .returning({ id: monitoringFindings.id });
  res.fixed += gone.length;
  return res;
}

/** Přijetí (výjimka s důvodem a termínem) nebo znovuotevření nálezu monitoringu. */
export async function setMonitoringStatus(db: Db, id: string, st: { status: "accepted" | "open"; note?: string; until?: string | null; userId: string }, now = new Date()) {
  const [r] = await db
    .update(monitoringFindings)
    .set(
      st.status === "accepted"
        ? { status: "accepted", note: st.note ?? null, acceptedById: st.userId, acceptedAt: now, acceptedUntil: st.until ?? null, updatedAt: now }
        : { status: "open", acceptedById: null, acceptedAt: null, acceptedUntil: null, updatedAt: now },
    )
    .where(and(eq(monitoringFindings.id, id), ne(monitoringFindings.status, "fixed")))
    .returning();
  return r ?? null;
}
