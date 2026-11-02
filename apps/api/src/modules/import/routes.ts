import {
  AssetInput,
  AssetPatch,
  ControlInput,
  ControlPatch,
  IMPORT_ENTITIES,
  IMPORT_ENTITY_LABELS,
  IMPORT_ENTITY_META,
  IMPORT_FIELDS,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  IMPORT_MODES,
  ProcessInput,
  ProcessPatch,
  RiskInput,
  RiskPatch,
  SupplierInput,
  SupplierPatch,
  normalizeLabel,
  normalizeReqId,
  parseCell,
  requirementById,
  suggestMapping,
  type ImportEntity,
  type ImportMode,
  type ImportPreviewDto,
  type ImportPreviewRow,
  type ImportResultDto,
  type Permission,
} from "@contix/shared";
import { eq, inArray } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import { currentUser, hasPerm, requirePerm } from "../../auth/middleware";
import { hasPermIn, scopeOf, targetCompany } from "../../auth/scope";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { assets, controls, orgUnits, positions, processes, risks, suppliers, users } from "../../db/schema";
import { readTable, writeXlsx, type Table } from "./table";
import { tFor } from "../i18n/service";
import { ApiError } from "../../lib/apiError";

/* ============================================================
 * Import reálných dat z Excelu / CSV (ADR-022). Náhled → mapování sloupců → zápis.
 * Zápis jde přes stejná API jako ruční evidence (interní požadavek s relací uživatele) – platí tatáž
 * validace, oprávnění, číslování, audit i vedlejší efekty. Existující záznam (kód / název, u aktiv
 * sériové číslo nebo hostname) se aktualizuje jen vyplněnými sloupci.
 * ============================================================ */

type Ctx = Context<AppEnv>;
export type Dispatch = (req: Request) => Response | Promise<Response>;

const SCHEMAS: Record<ImportEntity, { create: z.ZodType; patch: z.ZodType }> = {
  assets: { create: AssetInput, patch: AssetPatch },
  risks: { create: RiskInput, patch: RiskPatch },
  processes: { create: ProcessInput, patch: ProcessPatch },
  controls: { create: ControlInput, patch: ControlPatch },
  suppliers: { create: SupplierInput, patch: SupplierPatch },
};

interface Existing {
  id: string;
  label: string;
  keys: string[];
}

const isEntity = (v: unknown): v is ImportEntity => (IMPORT_ENTITIES as readonly string[]).includes(String(v));

export function importRoutes(deps: { db: Db; dispatch: () => Dispatch }) {
  const { db } = deps;

  async function load(c: Ctx) {
    const body = await c.req.parseBody();
    const entity = body.entity;
    if (!isEntity(entity)) throw new HTTPException(400, { message: "Neznámá evidence pro import" });
    const meta = IMPORT_ENTITY_META[entity];
    if (!(await getSettings(db)).enabledModules.includes(meta.module as never)) throw new HTTPException(409, { message: "Modul je vypnutý." });
    const companyId = targetCompany(c, typeof body.companyId === "string" ? body.companyId : null, meta.perm as Permission);
    const file = body.file;
    if (!(file instanceof File)) throw new HTTPException(400, { message: "Vyberte soubor (.xlsx nebo .csv)" });
    if (file.size > IMPORT_MAX_BYTES) throw new HTTPException(413, { message: "Soubor je větší než 10 MB" });
    let table: Table;
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const wanted = typeof body.sheet === "string" && body.sheet ? body.sheet : null;
      table = readTable(buf, file.name, wanted);
      // bez zvoleného listu vezmi první list s daty (úvodní list se šablonou přeskoč)
      if (!wanted && !table.rows.length) for (const s of table.sheets.slice(1)) {
        const t = readTable(buf, file.name, s);
        if (t.rows.length) {
          table = t;
          break;
        }
      }
    } catch (e) {
      throw new HTTPException(400, { message: (e as Error).message });
    }
    if (table.rows.length > IMPORT_MAX_ROWS) throw new ApiError(413, "err.import.tooManyRows", { max: String(IMPORT_MAX_ROWS) });
    let mapping: (string | null)[];
    if (typeof body.mapping === "string" && body.mapping) {
      try {
        const m = JSON.parse(body.mapping) as unknown[];
        const keys = new Set(IMPORT_FIELDS[entity].map((f) => f.key));
        mapping = table.headers.map((_, i) => (typeof m[i] === "string" && keys.has(m[i] as string) ? (m[i] as string) : null));
      } catch {
        throw new HTTPException(400, { message: "Neplatné mapování sloupců" });
      }
    } else mapping = suggestMapping(entity, table.headers);
    const mode: ImportMode = (IMPORT_MODES as readonly string[]).includes(String(body.mode)) ? (body.mode as ImportMode) : "upsert";
    return { entity, companyId, table, mapping, mode, filename: file.name };
  }

  /** Existující záznamy společnosti s klíči pro párování. */
  async function existing(entity: ImportEntity, companyId: string): Promise<Existing[]> {
    const k = (...v: (string | null | undefined)[]) => v.filter((x): x is string => !!x && !!x.trim()).map((x) => normalizeLabel(x));
    switch (entity) {
      case "assets":
        return (await db.select({ id: assets.id, name: assets.name, sn: assets.serialNumber, hn: assets.hostname }).from(assets).where(eq(assets.companyId, companyId))).map((r) => ({
          id: r.id,
          label: r.name,
          keys: [...k(r.sn).map((x) => `sn:${x}`), ...k(r.hn).map((x) => `hn:${x}`), ...k(r.name).map((x) => `name:${x}`)],
        }));
      case "risks":
        return (await db.select({ id: risks.id, name: risks.name, code: risks.code }).from(risks).where(eq(risks.companyId, companyId))).map((r) => ({ id: r.id, label: r.code ? `${r.code} ${r.name}` : r.name, keys: [...k(r.code).map((x) => `code:${x}`), ...k(r.name).map((x) => `name:${x}`)] }));
      case "processes":
        return (await db.select({ id: processes.id, name: processes.name, code: processes.code }).from(processes).where(eq(processes.companyId, companyId))).map((r) => ({ id: r.id, label: r.code ? `${r.code} ${r.name}` : r.name, keys: [...k(r.code).map((x) => `code:${x}`), ...k(r.name).map((x) => `name:${x}`)] }));
      case "controls":
        return (await db.select({ id: controls.id, name: controls.name, code: controls.code }).from(controls).where(eq(controls.companyId, companyId))).map((r) => ({ id: r.id, label: r.code ? `${r.code} ${r.name}` : r.name, keys: [...k(r.code).map((x) => `code:${x}`), ...k(r.name).map((x) => `name:${x}`)] }));
      case "suppliers":
        return (await db.select({ id: suppliers.id, name: suppliers.name, ico: suppliers.ico }).from(suppliers).where(eq(suppliers.companyId, companyId))).map((r) => ({ id: r.id, label: r.name, keys: [...k(r.ico).map((x) => `ico:${x}`), ...k(r.name).map((x) => `name:${x}`)] }));
    }
  }

  /** Klíče řádku v pořadí priority (kód / IČO / sériové číslo / hostname před názvem). */
  function rowKeys(entity: ImportEntity, d: Record<string, unknown>): string[] {
    const s = (v: unknown) => (typeof v === "string" && v.trim() ? normalizeLabel(v) : null);
    const out: (string | null)[] =
      entity === "assets"
        ? [s(d.serialNumber) && `sn:${s(d.serialNumber)}`, s(d.hostname) && `hn:${s(d.hostname)}`, s(d.name) && `name:${s(d.name)}`]
        : entity === "suppliers"
          ? [s(d.ico) && `ico:${s(d.ico)}`, s(d.name) && `name:${s(d.name)}`]
          : [s(d.code) && `code:${s(d.code)}`, s(d.name) && `name:${s(d.name)}`];
    return out.filter((x): x is string => !!x);
  }

  async function preview(c: Ctx): Promise<ImportPreviewDto & { companyId: string; _payloads: (Record<string, unknown> | null)[] }> {
    const { entity, companyId, table, mapping, mode } = await load(c);
    const t = await tFor(db, c);
    const fields = new Map(IMPORT_FIELDS[entity].map((f) => [f.key, f]));
    const posRows = await db.select({ id: positions.id, name: positions.name, code: positions.code }).from(positions).innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId)).where(eq(orgUnits.companyId, companyId));
    const pos = new Map<string, string>();
    for (const p of posRows) {
      pos.set(normalizeLabel(p.name), p.id);
      if (p.code) pos.set(normalizeLabel(p.code), p.id);
    }
    const emails = new Set<string>();
    mapping.forEach((m, i) => {
      if (m && fields.get(m)?.type === "user") for (const r of table.rows) if (r[i]?.trim()) emails.add(r[i]!.trim().toLowerCase());
    });
    const userIds = new Map((emails.size ? await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.email, [...emails])) : []).map((u) => [u.email.toLowerCase(), u.id]));
    const ex = await existing(entity, companyId);
    const byKey = new Map<string, Existing>();
    for (const e of ex) for (const k of e.keys) if (!byKey.has(k)) byKey.set(k, e);
    const seen = new Map<string, number>();
    const schema = SCHEMAS[entity];

    const rows: ImportPreviewRow[] = [];
    const payloads: (Record<string, unknown> | null)[] = [];
    table.rows.forEach((cells, idx) => {
      const data: Record<string, unknown> = {};
      const errors: string[] = [];
      const warnings: string[] = [];
      mapping.forEach((key, i) => {
        if (!key) return;
        const f = fields.get(key)!;
        const p = parseCell(f, cells[i] ?? "");
        if (p.error) return void errors.push(p.error);
        if (p.value === undefined) return;
        if (f.type === "position") {
          const id = pos.get(normalizeLabel(String(p.value)));
          if (id) data[key] = id;
          else warnings.push(t("srv.imp.warn.noPosition", { field: t.lbl(f.label), value: String(p.value) }));
        } else if (f.type === "user") {
          const id = userIds.get(String(p.value).toLowerCase());
          if (id) data[key] = id;
          else warnings.push(t("srv.imp.warn.noUser", { field: t.lbl(f.label), value: String(p.value) }));
        } else if (key === "requirementIds") {
          const ids = (p.value as string[]).map(normalizeReqId);
          const bad = ids.filter((x) => !requirementById(x));
          if (bad.length) warnings.push(t("srv.imp.warn.unknownReqs", { ids: bad.join(", ") }));
          data[key] = ids.filter((x) => requirementById(x));
        } else data[key] = p.value;
      });
      const keys = rowKeys(entity, data);
      const match = keys.map((k) => byKey.get(k)).find(Boolean) ?? null;
      const line = table.lines[idx] ?? idx + 2;
      const dupOf = keys.map((k) => seen.get(k)).find((x) => x != null);
      keys.forEach((k) => !seen.has(k) && seen.set(k, line));
      let action: ImportPreviewRow["action"] = match ? (mode === "upsert" ? "update" : "skip") : "create";
      if (dupOf != null) {
        warnings.push(t("srv.imp.warn.duplicate", { row: String(dupOf) }));
        action = "skip";
      }
      if (action === "skip" && match && dupOf == null) warnings.push(t("srv.imp.warn.exists", { label: match.label }));
      if (!errors.length && action !== "skip") {
        const r = (action === "create" ? schema.create : schema.patch).safeParse(data);
        if (!r.success) for (const iss of r.error.issues) errors.push(`${fields.get(String(iss.path[0]))?.label ?? iss.path.join(".")}: ${iss.message}`);
        if (action === "create") for (const f of IMPORT_FIELDS[entity]) if (f.required && data[f.key] == null && !errors.some((e) => e.startsWith(f.label) || e.startsWith(t.lbl(f.label)))) errors.push(t("srv.imp.err.required", { field: t.lbl(f.label) }));
      }
      rows.push({ row: line, data, errors, warnings, action, matchId: match?.id ?? null, matchLabel: match?.label ?? null });
      payloads.push(errors.length || action === "skip" ? null : { ...data, ...(action === "create" ? { companyId } : {}) });
    });
    const counts = {
      create: rows.filter((r) => !r.errors.length && r.action === "create").length,
      update: rows.filter((r) => !r.errors.length && r.action === "update").length,
      skip: rows.filter((r) => r.action === "skip").length,
      errors: rows.filter((r) => r.errors.length).length,
    };
    return { companyId, entity, sheets: table.sheets, sheet: table.sheet, headers: table.headers, mapping, samples: table.rows.slice(0, 3), rows, total: rows.length, counts, _payloads: payloads };
  }

  return new Hono<AppEnv>()
    .post("/preview", requirePerm("assets:write", "risks:write", "processes:write", "controls:write", "suppliers:write"), async (c) => {
      const { _payloads, companyId: _co, ...dto } = await preview(c);
      return c.json({ ...dto, rows: dto.rows.slice(0, 1000) } satisfies ImportPreviewDto);
    })
    .post("/commit", requirePerm("assets:write", "risks:write", "processes:write", "controls:write", "suppliers:write"), async (c) => {
      const p = await preview(c);
      const meta = IMPORT_ENTITY_META[p.entity];
      const dispatch = deps.dispatch();
      const base = new URL(c.req.url);
      const headers = {
        "content-type": "application/json",
        cookie: c.req.header("cookie") ?? "",
        origin: c.req.header("origin") ?? base.origin,
        "x-forwarded-for": c.req.header("x-forwarded-for") ?? "",
        // stejný rozsah jako import (cílová společnost)
        "x-contix-company": p.companyId,
      };
      const res: ImportResultDto = { created: 0, updated: 0, skipped: p.counts.skip, failed: [] };
      for (let i = 0; i < p.rows.length; i++) {
        const row = p.rows[i]!;
        const payload = p._payloads[i];
        if (row.errors.length) {
          res.failed.push({ row: row.row, error: row.errors.join("; ") });
          continue;
        }
        if (!payload) continue;
        const url = row.action === "update" ? `${base.origin}/api${meta.path}/${row.matchId}` : `${base.origin}/api${meta.path}`;
        const r = await dispatch(new Request(url, { method: row.action === "update" ? "PATCH" : "POST", headers, body: JSON.stringify(payload) }));
        if (r.ok) row.action === "update" ? res.updated++ : res.created++;
        else res.failed.push({ row: row.row, error: ((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${r.status}` });
      }
      await audit(db, {
        c,
        user: currentUser(c),
        action: "import.completed",
        entityType: p.entity,
        details: { entity: IMPORT_ENTITY_LABELS[p.entity], sheet: p.sheet, rows: p.total, created: res.created, updated: res.updated, skipped: res.skipped, failed: res.failed.length },
      });
      return c.json(res);
    })
    .get("/template/:entity", requirePerm("assets:write", "risks:write", "processes:write", "controls:write", "suppliers:write"), async (c) => {
      const entity = c.req.param("entity").replace(/\.xlsx$/, "");
      if (!isEntity(entity)) throw new HTTPException(404, { message: "Neznámá evidence" });
      const fields = IMPORT_FIELDS[entity];
      const t = await tFor(db, c);
      // názvy sloupců a hodnoty výčtů zůstávají česky – podle nich se soubor při importu páruje
      const allowed = (f: (typeof fields)[number]) =>
        f.type === "enum" ? Object.values(f.options ?? {}).join(" / ") : f.type === "bool" ? t("srv.imp.tpl.bool") : f.type === "list" ? t("srv.imp.tpl.list") : f.type === "date" ? t("srv.imp.tpl.date") : f.type === "position" ? t("srv.imp.tpl.position") : f.type === "user" ? t("srv.imp.tpl.user") : f.type === "int" ? t("srv.imp.tpl.int", { min: String(f.min), max: String(f.max) }) : t("srv.imp.tpl.text");
      const xlsx = writeXlsx([
        { name: IMPORT_ENTITY_LABELS[entity], rows: [fields.map((f) => f.label)], widths: fields.map((f) => Math.min(40, Math.max(14, f.label.length + 4))) },
        { name: t("srv.imp.tpl.help"), rows: [[t("srv.imp.tpl.column"), t("srv.imp.tpl.required"), t("srv.imp.tpl.values")], ...fields.map((f) => [f.label, f.required ? t("srv.imp.tpl.yes") : "", allowed(f)])], widths: [36, 10, 90] },
      ]);
      return c.body(xlsx as unknown as ArrayBuffer, 200, {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="contix-import-${entity}.xlsx"`,
      });
    })
    .get("/entities", requirePerm("assets:write", "risks:write", "processes:write", "controls:write", "suppliers:write"), (c) => {
      const sc = scopeOf(c);
      const ok = IMPORT_ENTITIES.filter((e) => hasPerm(c, IMPORT_ENTITY_META[e].perm as Permission) || sc.ids.some((id) => hasPermIn(c, IMPORT_ENTITY_META[e].perm as Permission, id)));
      return c.json(ok);
    });
}
