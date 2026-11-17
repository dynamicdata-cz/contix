import { AgentBatchInput, AgentRegisterInput, ConcentratorHelloInput, ConcentratorRegisterInput } from "@contix/shared";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import { audit } from "../../auth/service";
import type { Db } from "../../db/client";
import { scheduleAgentProcessing } from "./process";
import { authenticateConcentrator, ingestBatch, recordHello, registerAgent, registerConcentrator } from "./service";

/* ============================================================
 * Veřejné API koncentrátorů (ADR-177, fáze 1) – /api/public/agent/v1, mimo přihlášení i CSRF.
 * /register: jednorázový registrační kód v těle. Ostatní: podpis koncentrátoru (Ed25519) v hlavičkách,
 * ověřený v handleru přes `authenticateConcentrator` (proto v INLINE_GUARDED v review.test.ts).
 * ============================================================ */

const SMALL = 64 * 1024;
const BATCH = 8 * 1024 * 1024;

async function readText(c: Context, max: number): Promise<string> {
  if (Number(c.req.header("content-length") ?? 0) > max) throw new HTTPException(413, { message: "Požadavek koncentrátoru je příliš velký" });
  const text = await c.req.text();
  if (text.length > max) throw new HTTPException(413, { message: "Požadavek koncentrátoru je příliš velký" });
  return text;
}

function parse<T extends z.ZodTypeAny>(schema: T, text: string): z.infer<T> {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HTTPException(400, { message: "Požadavek koncentrátoru není platný JSON" });
  }
  const p = schema.safeParse(body);
  if (!p.success) throw new HTTPException(400, { message: `Neplatný požadavek koncentrátoru: ${p.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` });
  return p.data;
}

async function signedConcentrator(db: Db, c: Context, text: string) {
  const conc = await authenticateConcentrator(db, { method: c.req.method, path: c.req.path, header: (n) => c.req.header(n) }, text);
  if (!conc) throw new HTTPException(401, { message: "Neplatný podpis nebo neznámý koncentrátor" });
  return conc;
}

export function publicAgentRoutes(db: Db) {
  return new Hono()
    .post("/register", async (c) => {
      const input = parse(ConcentratorRegisterInput, await readText(c, SMALL));
      const r = await registerConcentrator(db, input);
      if (!r) throw new HTTPException(401, { message: "Neplatný, použitý nebo prošlý registrační kód koncentrátoru" });
      await audit(db, { c, action: "concentrator.registered", entityType: "connection", entityId: r.id, details: { hostname: input.hostname, version: input.version } });
      return c.json({ concentratorId: r.id, zone: r.zone }, 201);
    })
    .post("/agents", async (c) => {
      const text = await readText(c, SMALL);
      const conc = await signedConcentrator(db, c, text);
      const input = parse(AgentRegisterInput, text);
      const r = await registerAgent(db, conc, input);
      await audit(db, { c, action: "agent.registered", entityType: "agent", entityId: r.agentId, details: { concentratorId: conc.id, hostname: input.hostname, status: r.status } });
      return c.json(r);
    })
    .post("/hello", async (c) => {
      const text = await readText(c, SMALL);
      const conc = await signedConcentrator(db, c, text);
      await recordHello(db, conc, parse(ConcentratorHelloInput, text));
      return c.json({ ok: true });
    })
    .post("/batches", async (c) => {
      const text = await readText(c, BATCH);
      const conc = await signedConcentrator(db, c, text);
      const input = parse(AgentBatchInput, text);
      const r = await ingestBatch(db, conc, input.messages);
      // promítnutí do inventáře běží na pozadí – potvrzení (ack) na něm nezávisí
      void scheduleAgentProcessing(db, Object.keys(r.acks));
      return c.json(r);
    });
}
