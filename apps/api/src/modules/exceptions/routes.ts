import { EXCEPTION_KINDS, EXCEPTION_LABELS, EXCEPTION_STATES, ExceptionControlsInput, summarizeExceptions, type ExceptionKind, type Permission } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, requirePerm } from "../../auth/middleware";
import { hasPermIn, scopeOf } from "../../auth/scope";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { controls, exceptionControls } from "../../db/schema";
import { tFor } from "../i18n/service";
import { loadExceptions, type ExceptionScope } from "./service";

/* ============================================================
 * Výjimky a přijatá rizika – /api/exceptions (ADR-039). Výjimky se udělují a ruší u svých záznamů;
 * zde jen kompenzační opatření (v1.11, ADR-107).
 * ============================================================ */

/** Druh výjimky → oprávnění ke čtení a modul. */
export const EXCEPTION_ACCESS: Record<ExceptionKind, { perm: Permission; module: string }> = {
  identity_finding: { perm: "identity:read", module: "identity" },
  sod_violation: { perm: "identity:read", module: "identity" },
  vulnerability: { perm: "assets:read", module: "vulnerabilities" },
  risk_accepted: { perm: "risks:read", module: "risks" },
  requirement_na: { perm: "controls:read", module: "controls" },
  soc_suppression: { perm: "soc:read", module: "soc" },
};
const READ_PERMS = [...new Set(Object.values(EXCEPTION_ACCESS).map((a) => a.perm))];
/** Oprávnění k zápisu kompenzačních opatření podle druhu výjimky (v1.11). */
export const EXCEPTION_WRITE: Record<ExceptionKind, Permission> = {
  identity_finding: "identity:write",
  sod_violation: "identity:write",
  vulnerability: "assets:write",
  risk_accepted: "risks:write",
  requirement_na: "controls:write",
  soc_suppression: "soc:write",
};
const WRITE_PERMS = [...new Set(Object.values(EXCEPTION_WRITE))];
const writer = (c: Context<AppEnv>) => (k: ExceptionKind, companyId: string) => hasPermIn(c, EXCEPTION_WRITE[k], companyId);

async function scopeFor(db: Db, c: Context<AppEnv>): Promise<ExceptionScope> {
  const mods = new Set((await getSettings(db)).enabledModules as string[]);
  const ids = scopeOf(c).ids;
  return Object.fromEntries(
    EXCEPTION_KINDS.map((k) => [k, mods.has(EXCEPTION_ACCESS[k].module) ? ids.filter((id) => hasPermIn(c, EXCEPTION_ACCESS[k].perm, id)) : []]),
  ) as ExceptionScope;
}

const Query = z.object({ kind: z.enum(EXCEPTION_KINDS).optional(), state: z.enum(EXCEPTION_STATES).optional() });

export function exceptionRoutes(db: Db) {
  return new Hono<AppEnv>()
    .get("/", requirePerm(...READ_PERMS), zValidator("query", Query), async (c) => {
      const scope = await scopeFor(db, c);
      const all = await loadExceptions(db, scope, undefined, writer(c));
      const { kind, state } = c.req.valid("query");
      const items = all.filter((e) => (!kind || e.kind === kind) && (!state || e.state === state));
      return c.json({ items, summary: summarizeExceptions(all), kinds: EXCEPTION_KINDS.filter((k) => (scope[k]?.length ?? 0) > 0) });
    })
    .get("/export", requirePerm(...READ_PERMS), async (c) => {
      const items = await loadExceptions(db, await scopeFor(db, c));
      const t = await tFor(db, c);
      const esc = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;
      const head = ["kind", "title", "detail", "severity", "reason", "acceptedBy", "until", "state", "compensating"].map((k) => t.dyn(`exc.csv.${k}`, k));
      const rows = items.map((e) =>
        [
          t.dyn(`enum.exception.kind.${e.kind}`, EXCEPTION_LABELS.kind[e.kind]),
          e.title,
          e.detail ?? "",
          e.severity ?? "",
          e.reason ?? "",
          e.acceptedByName ?? "",
          e.until ?? "",
          t.dyn(`enum.exception.state.${e.state}`, EXCEPTION_LABELS.state[e.state]),
          e.compensating.map((x) => (x.code ? `${x.code} ${x.name}` : x.name)).join(", "),
        ]
          .map(esc)
          .join(";"),
      );
      await audit(db, { c, user: currentUser(c), action: "report.exported", details: { report: "exceptions", count: items.length } });
      return c.body(`﻿${[head.map(esc).join(";"), ...rows].join("\r\n")}\r\n`, 200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="vyjimky.csv"',
      });
    })
    /** Kompenzační opatření k výjimce (v1.11, ADR-107) – nahradí celý seznam; opatření ze společnosti výjimky. */
    .put(
      "/:kind/:id/controls",
      requirePerm(...WRITE_PERMS),
      zValidator("param", z.object({ kind: z.enum(EXCEPTION_KINDS), id: z.string().min(1).max(200) })),
      zValidator("json", ExceptionControlsInput),
      async (c) => {
        const { kind, id } = c.req.valid("param");
        const v = c.req.valid("json");
        const scope = await scopeFor(db, c);
        const exc = (await loadExceptions(db, { [kind]: scope[kind] ?? [] })).find((e) => e.kind === kind && e.id === id);
        if (!exc) throw new HTTPException(404, { message: "Výjimka nenalezena" });
        if (!hasPermIn(c, EXCEPTION_WRITE[kind], exc.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        const ids = [...new Set(v.controlIds)];
        if (ids.length) {
          const found = await db.select({ id: controls.id, companyId: controls.companyId }).from(controls).where(inArray(controls.id, ids));
          if (found.length !== ids.length || found.some((f) => f.companyId !== exc.companyId)) throw new HTTPException(400, { message: "Opatření musí patřit do společnosti výjimky" });
        }
        await db.transaction(async (tx) => {
          await tx.delete(exceptionControls).where(and(eq(exceptionControls.kind, kind), eq(exceptionControls.recordId, id)));
          if (ids.length)
            await tx.insert(exceptionControls).values(ids.map((controlId) => ({ companyId: exc.companyId, kind, recordId: id, title: exc.title.slice(0, 500), controlId, note: v.note ?? null, createdById: currentUser(c).id })));
        });
        await audit(db, { c, user: currentUser(c), action: "exception.compensating_set", entityType: kind, entityId: id.length === 36 ? id : undefined, details: { title: exc.title, controls: ids.length, note: v.note ?? null } });
        const [fresh] = (await loadExceptions(db, { [kind]: scope[kind] ?? [] }, undefined, writer(c))).filter((e) => e.kind === kind && e.id === id);
        return c.json(fresh);
      },
    );
}
