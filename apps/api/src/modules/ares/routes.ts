import { RES_EMPLOYEE_CLASSES, aresQueryKind, sizeFromHeadcount, suggestServices, validIco, type AresSubject, type ResLookupDto, type ResSubject } from "@contix/shared";
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

type RawRes = {
  ico?: string;
  obchodniJmeno?: string;
  pravniForma?: string;
  datumVzniku?: string;
  datumAktualizace?: string;
  czNace?: string[];
  czNace2008?: string[];
  czNacePrevazujici?: string;
  czNacePrevazujici2008?: string;
  primarniZaznam?: boolean;
  sidlo?: { textovaAdresa?: string };
  statistickeUdaje?: { institucionalniSektor2010?: string; kategoriePoctuPracovniku?: string };
};

/** Záznam RES (Registr ekonomických subjektů ČSÚ) z ARES – činnosti CZ-NACE, sektor, kategorie zaměstnanců (v1.61). */
export function mapRes(body: { zaznamy?: RawRes[] }): ResSubject | null {
  const list = body.zaznamy ?? [];
  const r = list.find((x) => x.primarniZaznam) ?? list[0];
  if (!r?.ico || !r.obchodniJmeno) return null;
  const cls = r.statistickeUdaje?.kategoriePoctuPracovniku ?? null;
  const range = cls ? RES_EMPLOYEE_CLASSES[cls] : undefined;
  const nace = [...new Set([...(r.czNace ?? []), ...(r.czNace2008 ?? [])])].filter((x) => /^\d{2,5}$/.test(x));
  return {
    ico: r.ico,
    name: r.obchodniJmeno.trim(),
    address: r.sidlo?.textovaAdresa?.trim() || null,
    legalForm: r.pravniForma ?? null,
    foundedAt: r.datumVzniku ?? null,
    primaryNace: r.czNacePrevazujici ?? r.czNacePrevazujici2008 ?? null,
    nace,
    esaSector: r.statistickeUdaje?.institucionalniSektor2010 ?? null,
    employeeClass: cls,
    employeeClassLabel: range?.label ?? null,
    sizeEstimate: range ? sizeFromHeadcount(range.min, range.max) : null,
    updatedAt: r.datumAktualizace ?? null,
  };
}

export class AresClient {
  private resCache = new Map<string, { at: number; v: ResLookupDto | null }>();
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

  /** RES podle IČO + návrh regulovaných služeb (null = subjekt v RES není). */
  async res(ico: string): Promise<ResLookupDto | null> {
    if (!validIco(ico)) throw new ApiError(400, "err.ares.invalidIco");
    const hit = this.resCache.get(ico);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.v;
    const res = await this.call(`/ekonomicke-subjekty-res/${ico}`);
    let v: ResLookupDto | null = null;
    if (res.status === 404) v = null;
    else if (!res.ok) throw new ApiError(502, "err.ares.failed", { status: String(res.status) });
    else {
      const subject = mapRes((await res.json()) as { zaznamy?: RawRes[] });
      v = subject ? { subject, suggestions: suggestServices(subject.nace, subject.esaSector, subject.primaryNace) } : null;
    }
    if (this.resCache.size > 500) this.resCache.clear();
    this.resCache.set(ico, { at: Date.now(), v });
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
    })
    /** RES (ČSÚ) přes ARES – podklad pro určení regulace podle vyhl. 408/2025 (v1.61, ADR-156). */
    .get("/res/:ico", requirePerm("suppliers:write", "admin:settings"), async (c) => {
      if (!enabled) throw new ApiError(409, "err.ares.disabled");
      const v = await client.res(c.req.param("ico"));
      if (!v) throw new ApiError(404, "err.ares.resNotFound");
      return c.json(v);
    });
}
