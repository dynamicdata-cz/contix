import { HostInventoryInput, type HostInventory } from "@contix/shared";
import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import type { Db } from "../../db/client";
import { agentEvents, agents, connections } from "../../db/schema";
import { ingestInventory } from "../collector/service";

/* ============================================================
 * Zpracování zpráv agentů (ADR-177, fáze 2): snímek a změny schváleného agenta se skládají do stavu hostitele
 * (`agents.state`) a ten se promítá do inventáře serveru (Discovery → Servery) – stejné nálezy, časová osa
 * změn i párování s aktivem jako u sběrače. Aktivum agent sám nezakládá: bez jednoznačné shody (machine-id,
 * jméno, adresa) zůstane server nespárovaný a správce ho založí nebo spáruje ručně.
 * ============================================================ */

/** Stav hostitele: modul → klíč položky → položka (jako snímek agenta). */
export interface AgentHostState {
  host: Record<string, unknown>;
  modules: Record<string, Record<string, unknown>>;
  errors?: Record<string, string>;
  /** Čas zprávy, ze které stav naposledy vzešel. */
  at: string;
}

interface Change {
  module: string;
  op: "add" | "remove" | "modify";
  key: string;
  to?: unknown;
}

/** Nad tolik nezpracovaných zpráv (fronta po schválení) se do inventáře promítne jen výsledný stav. */
const STEPWISE_MAX = 20;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null);
const items = (st: AgentHostState, mod: string) => Object.values(st.modules[mod] ?? {}).map(obj);

/** Použije zprávu na stav; vrací null, když zpráva stav nemění (hello, změny bez výchozího snímku). */
export function applyAgentMessage(state: AgentHostState | null, kind: string, payload: unknown, ts: string): AgentHostState | null {
  const p = obj(payload);
  if (kind === "snapshot") {
    const modules: AgentHostState["modules"] = {};
    for (const [m, v] of Object.entries(obj(p.modules))) modules[m] = { ...obj(v) };
    return { host: obj(p.host), modules, errors: obj(p.errors) as Record<string, string>, at: ts };
  }
  if (kind === "change" && state) {
    const next: AgentHostState = { ...state, modules: { ...state.modules }, at: ts };
    for (const c of (Array.isArray(p.changes) ? p.changes : []) as Change[]) {
      if (!c || typeof c.module !== "string" || typeof c.key !== "string") continue;
      const mod = { ...(next.modules[c.module] ?? {}) };
      if (c.op === "remove") delete mod[c.key];
      else if (c.op === "add" || c.op === "modify") mod[c.key] = c.to;
      next.modules[c.module] = mod;
    }
    return next;
  }
  return null;
}

/** Stav agenta → inventář serveru ve formátu sběrače (`HostInventoryInput`). */
export function agentStateToInventory(st: AgentHostState, agent: { hostId: string; version: string | null }): HostInventory | null {
  const h = st.host;
  const fwItem = obj(Object.values(st.modules.firewall ?? {})[0]);
  const fwTool = str(fwItem.tool, 20);
  const policy = str(fwItem.inputPolicy, 20).toLowerCase();
  const rulesHash = str(fwItem.rulesHash, 64) || null;
  const raw = {
    collectorVersion: `agent ${str(agent.version, 13)}`.trim(),
    collectedAt: st.at,
    host: {
      hostname: str(h.hostname, 255),
      fqdn: null,
      machineId: (str(h.hostId, 64) || agent.hostId.slice(0, 64)).toLowerCase(),
      os: str(h.os, 200) || null,
      kernel: str(h.kernel, 200) || null,
      ips: (Array.isArray(h.ips) ? h.ips : []).map((v) => str(v, 64)).filter(Boolean).slice(0, 64),
    },
    // jako sběrač: jen účty s přihlášením, správci a UID 0 – systémové účty bez shellu inventář jen zahlcují
    users: items(st, "accounts")
      .filter((a) => str(a.name, 64) && (a.login === true || a.admin === true || num(a.uid) === 0))
      .map((a) => ({ name: str(a.name, 64), uid: Math.max(0, num(a.uid) ?? 0), shell: str(a.shell, 200), home: str(a.home, 300), sudo: a.admin === true, locked: a.locked === true, lastLogin: null })),
    sshKeys: items(st, "ssh_keys")
      .filter((k) => str(k.user, 64) && str(k.fingerprint, 120))
      .map((k) => ({
        user: str(k.user, 64),
        type: str(k.type, 40),
        bits: num(k.bits) || null,
        fingerprint: str(k.fingerprint, 120),
        comment: str(k.comment, 300),
        options: (Array.isArray(k.options) ? k.options : []).map((o) => str(o, 300)).slice(0, 20),
      })),
    services: items(st, "services")
      .filter((s) => str(s.name, 200))
      .map((s) => {
        const enabled = str(s.enabled, 40);
        return { name: str(s.name, 200), state: s.active === "failed" ? "failed" : str(s.sub, 40) || str(s.active, 40), enabled: enabled ? enabled.startsWith("enabled") : null };
      }),
    listening: items(st, "ports")
      .map((p) => ({ proto: str(p.proto, 10), address: str(p.address, 100), port: num(p.port) ?? -1, process: str(p.process, 200) || null }))
      .filter((p) => p.port >= 0 && p.port <= 65535),
    firewall: {
      tool: fwTool === "nftables" || fwTool === "iptables" ? fwTool : "none",
      rulesHash,
      // agent zatím neposílá otisk uložené konfigurace – bez něj nehlásit „neuložená pravidla“
      savedHash: rulesHash,
      defaultInput: policy === "accept" || policy === "drop" || policy === "reject" ? policy : null,
      ruleCount: Math.max(0, num(fwItem.ruleCount) ?? 0),
    },
    packages: items(st, "packages")
      .filter((p) => str(p.name, 200))
      .map((p) => ({ name: str(p.name, 200), version: str(p.version, 200), arch: str(p.arch, 40) })),
    scheduled: items(st, "scheduled").map((t) => ({ source: str(t.source, 300), user: str(t.user, 100), schedule: str(t.schedule, 200), program: str(t.program, 300), state: str(t.state, 40) })),
  };
  const r = HostInventoryInput.safeParse(raw);
  return r.success ? r.data : null;
}

/**
 * Promítne nezpracované zprávy schváleného agenta (v pořadí, jen do potvrzeného `ackSeq` – bez mezer) do stavu
 * hostitele a inventáře serveru. Bezpečné opakovat; běží po příjmu dávky a po schválení agenta.
 */
export async function processAgent(db: Db, agentId: string): Promise<{ processed: number; inventoryId: string | null }> {
  const [row] = await db.select({ a: agents, conn: connections }).from(agents).innerJoin(connections, eq(connections.id, agents.connectionId)).where(and(eq(agents.id, agentId), isNull(agents.retiredAt)));
  if (!row || row.a.status !== "approved") return { processed: 0, inventoryId: row?.a.inventoryId ?? null };
  const { a, conn } = row;
  const pending = await db
    .select({ id: agentEvents.id, kind: agentEvents.kind, ts: agentEvents.ts, message: agentEvents.message })
    .from(agentEvents)
    .where(and(eq(agentEvents.agentId, a.id), isNull(agentEvents.processedAt), eq(agentEvents.quarantined, false), lte(agentEvents.seq, a.ackSeq)))
    .orderBy(asc(agentEvents.seq));
  if (!pending.length) return { processed: 0, inventoryId: a.inventoryId };

  let state = (a.state as AgentHostState | null) ?? null;
  let inventoryId = a.inventoryId;
  let dirty = false;
  const stepwise = pending.length <= STEPWISE_MAX;
  const project = async () => {
    const inv = state ? agentStateToInventory(state, a) : null;
    if (inv) inventoryId = (await ingestInventory(db, conn, inv, { source: "agent", createAsset: false })).inventoryId;
    dirty = false;
  };
  for (const ev of pending) {
    const next = applyAgentMessage(state, ev.kind, obj(ev.message).payload, ev.ts.toISOString());
    if (next) {
      state = next;
      dirty = true;
      if (stepwise) await project();
    }
  }
  if (dirty) await project();
  await db.update(agents).set({ state: state as unknown as Record<string, unknown>, inventoryId, updatedAt: new Date() }).where(eq(agents.id, a.id));
  for (let i = 0; i < pending.length; i += 1000)
    await db
      .update(agentEvents)
      .set({ processedAt: new Date() })
      .where(inArray(agentEvents.id, pending.slice(i, i + 1000).map((e) => e.id)));
  return { processed: pending.length, inventoryId };
}

/* Zpracování jednoho agenta běží vždy jen jednou naráz (dávky a schválení se řadí za sebe). */
const running = new Map<string, Promise<unknown>>();

/** Zařadí zpracování agentů; vrací slib dokončení (příjem dávky na něj nečeká, testy ano). */
export function scheduleAgentProcessing(db: Db, agentIds: Iterable<string>, log: (msg: string) => void = (m) => console.error(m)): Promise<void> {
  const all: Promise<unknown>[] = [];
  for (const id of agentIds) {
    const prev = running.get(id) ?? Promise.resolve();
    const p = prev
      .catch(() => undefined)
      .then(() => processAgent(db, id))
      .catch((e: unknown) => log(`agent ${id}: zpracování selhalo: ${(e as Error).message}`))
      .finally(() => {
        if (running.get(id) === p) running.delete(id);
      });
    running.set(id, p);
    all.push(p);
  }
  return Promise.all(all).then(() => undefined);
}

/**
 * Dohnání nezpracovaných zpráv schválených agentů – po startu API (např. schválení ve starší verzi, pád během
 * zpracování) a pak pravidelně. Běžně je nic nečeká: zprávy se zpracují hned po příjmu dávky nebo schválení.
 */
export async function processPendingAgents(db: Db): Promise<number> {
  const rows = await db
    .selectDistinct({ id: agents.id })
    .from(agents)
    .innerJoin(agentEvents, eq(agentEvents.agentId, agents.id))
    .where(and(eq(agents.status, "approved"), isNull(agents.retiredAt), isNull(agentEvents.processedAt), eq(agentEvents.quarantined, false), lte(agentEvents.seq, agents.ackSeq)));
  if (rows.length) await scheduleAgentProcessing(db, rows.map((r) => r.id));
  return rows.length;
}

/** Spustí dohnání po startu a pak každých 10 minut. */
export function startAgentCatchUp(db: Db, everyMs = 10 * 60_000): () => void {
  const run = () => void processPendingAgents(db).catch((e: unknown) => console.error(`agenti: dohnání zpracování selhalo: ${(e as Error).message}`));
  const first = setTimeout(run, 5_000);
  const timer = setInterval(run, everyMs);
  return () => (clearTimeout(first), clearInterval(timer));
}
