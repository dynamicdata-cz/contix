import { createHash, randomBytes, verify as edVerify, type KeyObject } from "node:crypto";
import {
  AGENT_BATCH_MAX,
  CONCENTRATOR_CLOCK_SKEW_S,
  CONCENTRATOR_CODE_PREFIX,
  CONCENTRATOR_CODE_TTL_HOURS,
  CONCENTRATOR_HEADERS,
  concentratorSigningString,
  ROOT_COMPANY_ID,
  type AgentBatchResult,
  type AgentDto,
  type AgentRegisterInput,
  type AgentStatus,
  type ConcentratorConnectionDto,
  type ConcentratorConnectionInput,
  type ConcentratorHello,
  type ConcentratorRegisterInput,
} from "@contix/shared";
import { and, count, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { agentEvents, agents, connections, hostInventories } from "../../db/schema";
import { agentPublicKey, verifyAgentMessage } from "./verify";

/* ============================================================
 * Koncentrátory a agenti (ADR-177, fáze 1).
 * Koncentrátor = připojení `concentrator`: registrační kód (v DB jen SHA-256, 24 h, jednorázový) → veřejný klíč
 * Ed25519 koncentrátoru; každý další požadavek koncentrátoru je podepsaný (`authenticateConcentrator`).
 * Agenty registruje koncentrátor; zprávy agentů se ověřují klíčem AGENTA (koncentrátor je podvrhnout nemůže),
 * neschválený agent = karanténa, blokovaný = zahodit. Duplicita (agent, seq) se nezapíše; potvrzení = souvislé seq.
 * ============================================================ */

type ConnRow = typeof connections.$inferSelect;
type AgentRow = typeof agents.$inferSelect;

/** Konfigurace koncentrátoru v `connections.config` (bez tajemství – jen otisky a veřejné klíče). */
interface ConcentratorConfig {
  zone: string;
  autoApprove: boolean;
  codeHash?: string;
  codeExpiresAt?: string;
  publicKey?: string;
  keyFingerprint?: string;
  hostname?: string;
  version?: string;
  registeredAt?: string;
  lastSeenAt?: string;
  status?: ConcentratorHello;
}

const KIND = "concentrator";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha256hex = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const cfgOf = (r: ConnRow) => r.config as unknown as ConcentratorConfig;

/** Otisk veřejného klíče `SHA256:<base64 bez zarovnání>` – stejný jako `identity.Fingerprint` v agentovi. */
export function keyFingerprint(publicKeyB64: string): string {
  return `SHA256:${createHash("sha256").update(Buffer.from(publicKeyB64, "base64")).digest("base64").replace(/=+$/, "")}`;
}

export function newConcentratorCode(now = new Date()) {
  const code = `${CONCENTRATOR_CODE_PREFIX}${randomBytes(24).toString("base64url")}`;
  return { code, hash: sha256hex(code), expiresAt: new Date(now.getTime() + CONCENTRATOR_CODE_TTL_HOURS * 3600_000).toISOString() };
}

/* ---------------- správa (Administrace → Konektory) ---------------- */

export async function saveConcentrator(db: Db, id: string | null, i: ConcentratorConnectionInput): Promise<{ id: string; code: string | null; codeExpiresAt: string | null }> {
  const base = { kind: KIND, name: i.name, enabled: i.enabled ?? true, companyId: i.companyId ?? null, updatedAt: new Date() };
  if (id) {
    const [row] = await db.select().from(connections).where(and(eq(connections.id, id), eq(connections.kind, KIND)));
    if (!row) throw new Error("not found");
    await db
      .update(connections)
      .set({ ...base, config: { ...cfgOf(row), zone: i.zone, autoApprove: i.autoApprove ?? false } })
      .where(eq(connections.id, id));
    return { id, code: null, codeExpiresAt: null };
  }
  const c = newConcentratorCode();
  const config: ConcentratorConfig = { zone: i.zone, autoApprove: i.autoApprove ?? false, codeHash: c.hash, codeExpiresAt: c.expiresAt };
  const [r] = await db.insert(connections).values({ ...base, config: config as unknown as Record<string, unknown> }).returning({ id: connections.id });
  return { id: r!.id, code: c.code, codeExpiresAt: c.expiresAt };
}

/** Nový registrační kód (např. reinstalace koncentrátoru). Starý kód přestane platit; registrovaný klíč platí do nové registrace. */
export async function renewConcentratorCode(db: Db, id: string): Promise<{ code: string; codeExpiresAt: string }> {
  const [row] = await db.select().from(connections).where(and(eq(connections.id, id), eq(connections.kind, KIND)));
  if (!row) throw new Error("not found");
  const c = newConcentratorCode();
  await db
    .update(connections)
    .set({ config: { ...cfgOf(row), codeHash: c.hash, codeExpiresAt: c.expiresAt } as unknown as Record<string, unknown>, updatedAt: new Date() })
    .where(eq(connections.id, id));
  return { code: c.code, codeExpiresAt: c.expiresAt };
}

export async function concentratorDtos(db: Db): Promise<ConcentratorConnectionDto[]> {
  const rows = await db.select().from(connections).where(eq(connections.kind, KIND)).orderBy(connections.createdAt);
  if (!rows.length) return [];
  const stats = await db
    .select({ id: agents.connectionId, status: agents.status, n: count() })
    .from(agents)
    .where(and(inArray(agents.connectionId, rows.map((r) => r.id)), isNull(agents.retiredAt)))
    .groupBy(agents.connectionId, agents.status);
  const now = Date.now();
  return rows.map((r) => {
    const cfg = cfgOf(r);
    const n = (s: AgentStatus) => stats.find((x) => x.id === r.id && x.status === s)?.n ?? 0;
    const codeValid = !!cfg.codeHash && !!cfg.codeExpiresAt && Date.parse(cfg.codeExpiresAt) > now;
    return {
      id: r.id,
      kind: "concentrator",
      name: r.name,
      enabled: r.enabled,
      companyId: r.companyId,
      zone: cfg.zone ?? "",
      autoApprove: !!cfg.autoApprove,
      registered: !!cfg.publicKey,
      keyFingerprint: cfg.keyFingerprint ?? null,
      hostname: cfg.hostname ?? null,
      version: cfg.version ?? null,
      codeExpiresAt: codeValid ? cfg.codeExpiresAt! : null,
      lastSeenAt: cfg.lastSeenAt ?? null,
      agents: { pending: n("pending"), approved: n("approved"), blocked: n("blocked") },
      status: cfg.status ?? null,
    };
  });
}

export async function agentDtos(db: Db): Promise<AgentDto[]> {
  const rows = await db
    .select({ a: agents, conn: { name: connections.name, config: connections.config }, assetId: hostInventories.assetId })
    .from(agents)
    .innerJoin(connections, eq(connections.id, agents.connectionId))
    .leftJoin(hostInventories, eq(hostInventories.id, agents.inventoryId))
    .where(isNull(agents.retiredAt))
    .orderBy(agents.hostname);
  if (!rows.length) return [];
  const ev = await db
    .select({ id: agentEvents.agentId, n: count(), q: sql<number>`count(*) filter (where ${agentEvents.quarantined})`.mapWith(Number) })
    .from(agentEvents)
    .where(inArray(agentEvents.agentId, rows.map((r) => r.a.id)))
    .groupBy(agentEvents.agentId);
  return rows.map(({ a, conn, assetId }) => {
    const e = ev.find((x) => x.id === a.id);
    return {
      id: a.id,
      concentratorId: a.connectionId,
      concentratorName: conn.name,
      zone: String((conn.config as Record<string, unknown>).zone ?? ""),
      companyId: a.companyId,
      hostname: a.hostname,
      hostId: a.hostId,
      os: a.os,
      version: a.version,
      keyFingerprint: a.keyFingerprint,
      status: a.status,
      ackSeq: a.ackSeq,
      lastSeenAt: a.lastSeenAt?.toISOString() ?? null,
      events: e?.n ?? 0,
      quarantined: e?.q ?? 0,
      approvedAt: a.approvedAt?.toISOString() ?? null,
      inventoryId: a.inventoryId,
      assetId: assetId ?? null,
    };
  });
}

/** Schválení uvolní karanténu (zprávy půjdou ke zpracování), blokace další zprávy zahazuje. */
export async function setAgentStatus(db: Db, id: string, status: "approved" | "blocked", userId: string | null): Promise<AgentRow | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(agents)
      .set(status === "approved" ? { status, approvedBy: userId, approvedAt: new Date(), updatedAt: new Date() } : { status, updatedAt: new Date() })
      .where(and(eq(agents.id, id), isNull(agents.retiredAt)))
      .returning();
    if (!row) return null;
    if (status === "approved") await tx.update(agentEvents).set({ quarantined: false }).where(and(eq(agentEvents.agentId, id), eq(agentEvents.quarantined, true)));
    return row;
  });
}

/* ---------------- koncentrátor (veřejné API) ---------------- */

/** Registrace koncentrátoru platným nepoužitým kódem → uloží jeho veřejný klíč a kód zneplatní. null = neplatný kód. */
export async function registerConcentrator(db: Db, i: ConcentratorRegisterInput, now = new Date()): Promise<{ id: string; zone: string; companyId: string | null } | null> {
  agentPublicKey(i.publicKey); // ověří tvar klíče (vyhodí chybu)
  const [row] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.kind, KIND), eq(connections.enabled, true), sql`${connections.config}->>'codeHash' = ${sha256hex(i.code)}`));
  if (!row) return null;
  const cfg = cfgOf(row);
  if (!cfg.codeExpiresAt || Date.parse(cfg.codeExpiresAt) <= now.getTime()) return null;
  const { codeHash: _h, codeExpiresAt: _e, ...rest } = cfg;
  const next: ConcentratorConfig = { ...rest, publicKey: i.publicKey, keyFingerprint: keyFingerprint(i.publicKey), hostname: i.hostname, version: i.version ?? "", registeredAt: now.toISOString(), lastSeenAt: now.toISOString() };
  // podmínka na otisk kódu: dva souběžné pokusy se stejným kódem neprojdou oba
  const done = await db
    .update(connections)
    .set({ config: next as unknown as Record<string, unknown>, updatedAt: now })
    .where(and(eq(connections.id, row.id), sql`${connections.config}->>'codeHash' = ${sha256hex(i.code)}`))
    .returning({ id: connections.id });
  if (!done.length) return null;
  return { id: row.id, zone: cfg.zone, companyId: row.companyId };
}

/**
 * Ověří podepsaný požadavek koncentrátoru (hlavičky `CONCENTRATOR_HEADERS`, podpis Ed25519 nad
 * `concentratorSigningString`, čas ±5 min). Vrací připojení, nebo null. Tělo se předává jako přijatý text.
 */
export async function authenticateConcentrator(db: Db, req: { method: string; path: string; header: (name: string) => string | undefined }, body: string, now = new Date()): Promise<ConnRow | null> {
  const id = req.header(CONCENTRATOR_HEADERS.id) ?? "";
  const date = req.header(CONCENTRATOR_HEADERS.date) ?? "";
  const sig = Buffer.from(req.header(CONCENTRATOR_HEADERS.signature) ?? "", "base64");
  if (!UUID_RE.test(id) || sig.length !== 64) return null;
  const t = Date.parse(date);
  if (!Number.isFinite(t) || Math.abs(now.getTime() - t) > CONCENTRATOR_CLOCK_SKEW_S * 1000) return null;
  const [row] = await db.select().from(connections).where(and(eq(connections.id, id), eq(connections.kind, KIND), eq(connections.enabled, true)));
  const pub = row ? cfgOf(row).publicKey : undefined;
  if (!row || !pub) return null;
  const msg = concentratorSigningString(req.method, req.path, date, sha256hex(body));
  if (!edVerify(null, Buffer.from(msg, "utf8"), agentPublicKey(pub), sig)) return null;
  await db
    .update(connections)
    .set({ config: { ...cfgOf(row), lastSeenAt: now.toISOString() } as unknown as Record<string, unknown> })
    .where(eq(connections.id, row.id));
  return row;
}

/** Hlášení stavu koncentrátoru: verze, fronta, poslední chyba (přepíše předchozí). */
export async function recordHello(db: Db, conc: ConnRow, hello: Omit<ConcentratorHello, "receivedAt">, now = new Date()): Promise<void> {
  const [row] = await db.select().from(connections).where(eq(connections.id, conc.id));
  if (!row) return;
  const cfg = cfgOf(row);
  const status: ConcentratorHello = { ...hello, receivedAt: now.toISOString() };
  await db
    .update(connections)
    .set({ config: { ...cfg, status, version: hello.version || cfg.version, hostname: hello.hostname || cfg.hostname } as unknown as Record<string, unknown> })
    .where(eq(connections.id, conc.id));
}

/**
 * Registrace agenta koncentrátorem. Stejný hostitel se stejným klíčem = aktualizace údajů. Nový klíč (reinstalace)
 * = NOVÁ identita: starý záznam se uzavře (`retiredAt`, zprávy zůstávají), nový čeká na schválení a čísluje zprávy
 * od začátku – jinak by CONTIX nové zprávy zahodil jako duplicity starých. Blokovaný hostitel zůstává blokovaný.
 * Nový agent: schválený jen při `autoApprove` zóny.
 */
export async function registerAgent(db: Db, conc: ConnRow, i: AgentRegisterInput): Promise<{ agentId: string; status: AgentStatus }> {
  agentPublicKey(i.publicKey);
  const cfg = cfgOf(conc);
  const info = { hostname: i.hostname, os: i.os ?? "", version: i.version ?? "", lastSeenAt: new Date(), updatedAt: new Date() };
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(agents)
      .where(and(eq(agents.connectionId, conc.id), eq(agents.hostId, i.hostId), isNull(agents.retiredAt)))
      .for("update");
    if (existing && existing.status === "blocked") return { agentId: existing.id, status: "blocked" as const };
    if (existing && existing.publicKey === i.publicKey) {
      await tx.update(agents).set(info).where(eq(agents.id, existing.id));
      return { agentId: existing.id, status: existing.status };
    }
    if (existing) await tx.update(agents).set({ retiredAt: new Date(), updatedAt: new Date() }).where(eq(agents.id, existing.id));
    const status: AgentStatus = cfg.autoApprove ? "approved" : "pending";
    const [r] = await tx
      .insert(agents)
      .values({ ...info, connectionId: conc.id, companyId: conc.companyId ?? ROOT_COMPANY_ID, hostId: i.hostId, publicKey: i.publicKey, keyFingerprint: keyFingerprint(i.publicKey), status, approvedAt: status === "approved" ? new Date() : null })
      .returning({ id: agents.id });
    return { agentId: r!.id, status };
  });
}

/** Příjem dávky zpráv od koncentrátoru: ověření podpisu agenta, karanténa, zápis bez duplicit, potvrzení. */
export async function ingestBatch(db: Db, conc: ConnRow, messages: unknown[]): Promise<AgentBatchResult> {
  const result: AgentBatchResult = { acks: {}, accepted: 0, duplicates: 0, rejected: [] };
  const list = messages.slice(0, AGENT_BATCH_MAX);
  const field = (m: unknown, k: string) => (m && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, unknown>)[k] : undefined);
  const ids = [...new Set(list.map((m) => field(m, "agent")).filter((v): v is string => typeof v === "string" && UUID_RE.test(v)))];
  const rows = ids.length ? await db.select().from(agents).where(and(eq(agents.connectionId, conc.id), inArray(agents.id, ids), isNull(agents.retiredAt))) : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const keys = new Map<string, KeyObject>();
  const toInsert: (typeof agentEvents.$inferInsert)[] = [];
  const touched = new Set<string>();
  const versions = new Map<string, string>();

  list.forEach((m, index) => {
    const agentField = field(m, "agent");
    const seqField = field(m, "seq");
    const ref = { index, agent: typeof agentField === "string" ? agentField.slice(0, 64) : null, seq: typeof seqField === "number" ? seqField : null };
    const row = typeof agentField === "string" ? byId.get(agentField) : undefined;
    if (!row) return void result.rejected.push({ ...ref, reason: "unknown_agent" });
    if (row.status === "blocked") return void result.rejected.push({ ...ref, reason: "blocked" });
    let key = keys.get(row.id);
    if (!key) keys.set(row.id, (key = agentPublicKey(row.publicKey)));
    const v = verifyAgentMessage(m, key);
    if (!v.ok) return void result.rejected.push({ ...ref, reason: v.reason });
    const env = v.envelope;
    touched.add(row.id);
    if (env.kind === "hello" && typeof env.payload.version === "string") versions.set(row.id, env.payload.version.slice(0, 40));
    toInsert.push({ agentId: row.id, companyId: row.companyId, seq: env.seq, kind: env.kind, ts: new Date(env.ts), quarantined: row.status !== "approved", message: m as Record<string, unknown> });
  });

  for (let i = 0; i < toInsert.length; i += 200) {
    const chunk = toInsert.slice(i, i + 200);
    const ins = await db.insert(agentEvents).values(chunk).onConflictDoNothing().returning({ id: agentEvents.id });
    result.accepted += ins.length;
    result.duplicates += chunk.length - ins.length;
  }

  for (const id of touched) {
    const row = byId.get(id)!;
    let ack = row.ackSeq;
    const next = await db
      .select({ seq: agentEvents.seq })
      .from(agentEvents)
      .where(and(eq(agentEvents.agentId, id), gt(agentEvents.seq, ack)))
      .orderBy(agentEvents.seq)
      .limit(AGENT_BATCH_MAX * 10);
    for (const { seq } of next) {
      if (seq !== ack + 1) break;
      ack = seq;
    }
    await db
      .update(agents)
      .set({ ackSeq: ack, lastSeenAt: new Date(), updatedAt: new Date(), ...(versions.has(id) ? { version: versions.get(id)! } : {}) })
      .where(eq(agents.id, id));
    result.acks[id] = ack;
  }
  return result;
}
