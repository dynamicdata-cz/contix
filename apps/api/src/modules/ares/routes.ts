import { aresQueryKind, validIco, type AresSubject } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { requirePerm } from "../../auth/middleware";
import type { AppEnv } from "../../auth/service";
import type { Config } from "../../config";
import { ApiError } from "../../lib/apiError";

/* ARES – veřejné REST API Ministerstva financí (ADR-041). Jen čtení, odpovědi se krátce cachují. */

export type AresFetch = (input: string, init?: RequestInit) => Promise<Response>;
export const ARES_DEFAULT_URL = "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest";

type Raw = {
  ico?: string;
  obchodniJmeno?: string;
  dic?: string;
  pravniForma?: string;
  datumZaniku?: string;
  sidlo?: { textovaAdresa?: string; nazevStatu?: string; kodStatu?: string };
};

export function mapSubject(r: Raw): AresSubject | null {
  if (!r.ico || !r.obchodniJmeno) return null;
  return {
    ico: r.ico,
    name: r.obchodniJmeno.trim(),
    address: r.sidlo?.textovaAdresa?.trim() || null,
    country: r.sidlo?.nazevStatu ?? (r.sidlo?.kodStatu === "CZ" ? "Česká republika" : null),
    dic: r.dic ?? null,
    legalForm: r.pravniForma ?? null,
    dissolvedAt: r.datumZaniku ?? null,
  };
}

export class AresClient {
  private cache = new Map<string, { at: number; v: AresSubject[] }>();
  constructor(
    private base: string,
    private fetchImpl: AresFetch = (u, i) => fetch(u, i),
  ) {}

  private async call(path: string, init?: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.base.replace(/\/$/, "")}${path}`, { ...init, headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}) }, signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new ApiError(502, "err.ares.unreachable");
    }
  }

  async search(q: string): Promise<AresSubject[]> {
    const k = aresQueryKind(q);
    if (!k) return [];
    const key = k.kind === "ico" ? `i:${k.ico}` : `n:${k.name.toLowerCase()}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.v;
    let v: AresSubject[];
    if (k.kind === "ico") {
      if (!validIco(k.ico)) throw new ApiError(400, "err.ares.invalidIco");
      const res = await this.call(`/ekonomicke-subjekty/${k.ico}`);
      if (res.status === 404) v = [];
      else if (!res.ok) throw new ApiError(502, "err.ares.failed", { status: String(res.status) });
      else v = [mapSubject((await res.json()) as Raw)].filter((x): x is AresSubject => !!x);
    } else {
      const res = await this.call("/ekonomicke-subjekty/vyhledat", { method: "POST", body: JSON.stringify({ obchodniJmeno: k.name, start: 0, pocet: 10 }) });
      // ARES vrací 400 i při „příliš mnoho výsledků“ / nic nenalezeno – bereme jako prázdný výsledek
      if (res.status === 400 || res.status === 404) v = [];
      else if (!res.ok) throw new ApiError(502, "err.ares.failed", { status: String(res.status) });
      else v = (((await res.json()) as { ekonomickeSubjekty?: Raw[] }).ekonomickeSubjekty ?? []).map(mapSubject).filter((x): x is AresSubject => !!x);
    }
    if (this.cache.size > 500) this.cache.clear();
    this.cache.set(key, { at: Date.now(), v });
    return v;
  }
}

export function aresRoutes(deps: { config: Config; aresFetch?: AresFetch }) {
  const enabled = deps.config.ARES_SOURCE !== "off";
  const client = new AresClient(deps.config.ARES_URL ?? ARES_DEFAULT_URL, deps.aresFetch);
  return new Hono<AppEnv>()
    .get("/status", requirePerm("suppliers:write", "admin:settings"), (c) => c.json({ enabled }))
    .get("/search", requirePerm("suppliers:write", "admin:settings"), zValidator("query", z.object({ q: z.string().max(200) })), async (c) => {
      if (!enabled) throw new ApiError(409, "err.ares.disabled");
      return c.json(await client.search(c.req.valid("query").q));
    });
}
