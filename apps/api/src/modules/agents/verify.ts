import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { AgentEnvelopeV1, canonicalJson, type AgentEnvelope } from "@contix/shared";

/* ============================================================
 * Agenti (ADR-177): ověření podpisu zprávy agenta. Podpis Ed25519 nad kanonickým JSON (RFC 8785)
 * celé obálky bez pole `sig`. Ověřuje se VŽDY nad přijatou hodnotou (ne nad znovu sestaveným objektem)
 * a teprve po ověření se zpráva validuje schématem – dál se zpracovává jen to, co bylo podepsáno.
 * Klíč agenta = veřejný klíč schválený při registraci (32 B, base64).
 * ============================================================ */

/** DER předpona SubjectPublicKeyInfo pro Ed25519 (RFC 8410) – za ní následuje 32 B surového klíče. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Veřejný klíč agenta z base64 (32 B). Vyhodí chybu u jiné délky – klíč se ukládá jen po kontrole. */
export function agentPublicKey(base64: string): KeyObject {
  const raw = Buffer.from(base64, "base64");
  if (raw.length !== 32 || raw.toString("base64") !== base64) throw new Error("Neplatný veřejný klíč agenta (očekáváno 32 B v base64)");
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
}

export type AgentVerifyResult =
  | { ok: true; envelope: AgentEnvelope }
  | { ok: false; reason: "shape" | "signature" | "schema"; detail?: string };

/**
 * Ověří jednu zprávu agenta (hodnotu z `JSON.parse`). Pořadí: tvar → podpis → schéma.
 * Nic nezapisuje; rozhodnutí o přijetí (schválený agent, pořadí `seq`, karanténa) je na volajícím.
 */
export function verifyAgentMessage(message: unknown, key: KeyObject): AgentVerifyResult {
  if (message === null || typeof message !== "object" || Array.isArray(message)) return { ok: false, reason: "shape", detail: "zpráva není objekt" };
  const { sig, ...unsigned } = message as Record<string, unknown>;
  if (typeof sig !== "string") return { ok: false, reason: "signature", detail: "chybí podpis" };
  const sigBytes = Buffer.from(sig, "base64");
  if (sigBytes.length !== 64) return { ok: false, reason: "signature", detail: "podpis má špatnou délku" };
  let canonical: string;
  try {
    canonical = canonicalJson(unsigned);
  } catch (e) {
    return { ok: false, reason: "shape", detail: (e as Error).message };
  }
  if (!verify(null, Buffer.from(canonical, "utf8"), key, sigBytes)) return { ok: false, reason: "signature" };
  const parsed = AgentEnvelopeV1.safeParse(message);
  if (!parsed.success) {
    return { ok: false, reason: "schema", detail: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(zpráva)"}: ${i.message}`).join("; ") };
  }
  return { ok: true, envelope: parsed.data };
}
