import {
  COMPUTER_ROLE_LABELS,
  COMPUTER_ROLES,
  ComputerAssetsInput,
  IdentityPolicySchema,
  osSupport,
  ouOfDn,
  VULN_LABELS,
  type ComputerRole,
  type IdentityComputerDto,
  type IdentityComputerSummary,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { currentUser, requirePerm } from "../../auth/middleware";
import { inScope } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { assets, identityComputers, identityFindings, identitySources } from "../../db/schema";
import { tFor } from "../i18n/service";
import { writeXlsx } from "../import/table";
import { createComputerAssets, monitoringOf } from "./computers";

/* Počítače a servery z AD – /api/identity/computers (v1.90, ADR-185). */

const likeEsc = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

export const ComputerQuery = z.object({
  sourceId: z.string().uuid().optional(),
  role: z.enum(COMPUTER_ROLES).optional(),
  q: z.string().trim().max(200).optional(),
  /** stale = neaktivní, eol = nepodporovaný systém, noAsset = bez aktiva, unmonitored = server bez sběru dat, findings = s nálezy */
  view: z.enum(["stale", "eol", "noAsset", "unmonitored", "findings", "disabled"]).optional(),
  removed: z.enum(["1"]).optional(),
});
export type IdentityComputerQuery = z.infer<typeof ComputerQuery>;

export function computerRoutes(db: Db) {
  async function list(c: Context<AppEnv>, q: IdentityComputerQuery, limit = 5000) {
    const where: SQL[] = [q.removed ? isNotNull(identityComputers.removedAt) : isNull(identityComputers.removedAt)];
    if (q.sourceId) where.push(eq(identityComputers.sourceId, q.sourceId));
    if (q.role) where.push(eq(identityComputers.role, q.role));
    if (q.q) {
      const like = `%${likeEsc(q.q)}%`;
      where.push(or(ilike(identityComputers.name, like), ilike(identityComputers.dnsName, like), ilike(identityComputers.os, like), ilike(identityComputers.dn, like), ilike(identityComputers.description, like))!);
    }
    const open = db
      .select({ computerId: identityFindings.computerId, n: count().as("n") })
      .from(identityFindings)
      .where(and(eq(identityFindings.status, "open"), isNotNull(identityFindings.computerId)))
      .groupBy(identityFindings.computerId)
      .as("open_pc");
    const rows = await db
      .select({ pc: identityComputers, sourceName: identitySources.name, policy: identitySources.policy, assetName: assets.name, n: open.n })
      .from(identityComputers)
      .innerJoin(identitySources, eq(identitySources.id, identityComputers.sourceId))
      .leftJoin(assets, eq(assets.id, identityComputers.assetId))
      .leftJoin(open, eq(open.computerId, identityComputers.id))
      .where(and(inScope(c, identityComputers.companyId), ...where))
      .orderBy(sql`case ${identityComputers.role} when 'dc' then 1 when 'server' then 2 when 'workstation' then 3 else 4 end`, asc(identityComputers.name))
      .limit(50_000);
    const mon = await monitoringOf(
      db,
      [...new Set(rows.map((r) => r.pc.assetId).filter((x): x is string => !!x))],
    );
    const now = new Date();
    const all = rows.map((r) => {
      const staleDays = IdentityPolicySchema.parse(r.policy ?? {}).computerStaleDays;
      const sup = osSupport(r.pc.os, r.pc.osVersion, now);
      const last = r.pc.lastLogonAt ?? r.pc.dirCreatedAt;
      const stale = r.pc.enabled && r.pc.role !== "dc" && (!last || now.getTime() - last.getTime() > staleDays * 86_400_000);
      const monitoring = [...(r.pc.assetId ? (mon.get(r.pc.assetId) ?? []) : [])].sort();
      const server = r.pc.role === "server" || r.pc.role === "dc";
      const dto: IdentityComputerDto = {
        id: r.pc.id,
        sourceId: r.pc.sourceId,
        sourceName: r.sourceName,
        name: r.pc.name,
        dnsName: r.pc.dnsName,
        dn: r.pc.dn,
        ou: ouOfDn(r.pc.dn),
        os: r.pc.os,
        osVersion: r.pc.osVersion,
        support: sup.status,
        eolDate: sup.eolDate,
        role: r.pc.role as ComputerRole,
        enabled: r.pc.enabled,
        lastLogonAt: iso(r.pc.lastLogonAt),
        pwdLastSetAt: iso(r.pc.pwdLastSetAt),
        createdAt: iso(r.pc.dirCreatedAt),
        description: r.pc.description,
        spns: r.pc.spns ?? [],
        unconstrainedDelegation: r.pc.unconstrainedDelegation,
        constrainedDelegation: r.pc.constrainedDelegation,
        laps: r.pc.laps,
        asset: r.pc.assetId ? { id: r.pc.assetId, name: r.assetName ?? r.pc.name } : null,
        monitoring,
        openFindings: Number(r.n ?? 0),
        removedAt: iso(r.pc.removedAt),
      };
      return { dto, stale, unmonitored: server && r.pc.enabled && !stale && !monitoring.length };
    });
    const summary: IdentityComputerSummary = {
      total: all.length,
      enabled: all.filter((x) => x.dto.enabled).length,
      servers: all.filter((x) => x.dto.role === "server").length,
      workstations: all.filter((x) => x.dto.role === "workstation").length,
      dcs: all.filter((x) => x.dto.role === "dc").length,
      stale: all.filter((x) => x.stale).length,
      eol: all.filter((x) => x.dto.enabled && x.dto.support === "eol").length,
      noAsset: all.filter((x) => x.dto.enabled && !x.dto.asset).length,
      unmonitored: all.filter((x) => x.unmonitored).length,
      laps: all.filter((x) => x.dto.enabled && x.dto.laps).length,
    };
    const pick = all.filter((x) => {
      switch (q.view) {
        case "stale":
          return x.stale;
        case "eol":
          return x.dto.enabled && x.dto.support === "eol";
        case "noAsset":
          return x.dto.enabled && !x.dto.asset;
        case "unmonitored":
          return x.unmonitored;
        case "findings":
          return x.dto.openFindings > 0;
        case "disabled":
          return !x.dto.enabled;
        default:
          return true;
      }
    });
    return { items: pick.slice(0, limit).map((x) => x.dto), total: pick.length, summary };
  }

  async function exportList(c: Context<AppEnv>, format: "csv" | "xlsx") {
    const q = c.req.valid("query" as never) as IdentityComputerQuery;
    const { items } = await list(c, q, 50_000);
    const t = await tFor(db, c);
    const head = [
      t("srv.idn.pcName"),
      t("srv.idn.pcDns"),
      t("srv.idn.pcRole"),
      t("srv.idn.pcOs"),
      t("srv.idn.pcSupport"),
      t("srv.idn.pcLastLogon"),
      t("srv.idn.pcEnabled"),
      t("srv.idn.pcLaps"),
      t("srv.idn.pcDelegation"),
      t("srv.idn.pcAsset"),
      t("srv.idn.pcMonitoring"),
      t("srv.idn.pcFindings"),
      t("srv.idn.pcOu"),
      t("srv.idn.colSource"),
    ];
    const yes = (b: boolean) => (b ? t("srv.idn.yes") : t("srv.idn.no"));
    const data = items.map((p) => [
      p.name,
      p.dnsName ?? "",
      t.lbl(COMPUTER_ROLE_LABELS[p.role]) ?? p.role,
      [p.os, p.osVersion].filter(Boolean).join(" "),
      `${t.lbl(VULN_LABELS.support[p.support]) ?? p.support}${p.eolDate ? ` (${p.eolDate})` : ""}`,
      p.lastLogonAt?.slice(0, 10) ?? "",
      yes(p.enabled),
      yes(p.laps),
      p.unconstrainedDelegation ? t("srv.idn.pcUnconstrained") : p.constrainedDelegation ? t("srv.idn.pcConstrained") : "",
      p.asset?.name ?? "",
      p.monitoring.join(", "),
      String(p.openFindings),
      p.ou ?? "",
      p.sourceName,
    ]);
    await audit(db, { c, user: currentUser(c), action: "identity.computers_exported", entityType: "identity", details: { rows: items.length, format, filter: q } });
    const name = `pocitace-ad-${new Date().toISOString().slice(0, 10)}`;
    if (format === "xlsx")
      return new Response(new Uint8Array(writeXlsx([{ name: t("srv.idn.pcSheet"), rows: [head, ...data], widths: [20, 30, 14, 30, 22, 12, 8, 8, 14, 24, 18, 8, 30, 18] }])), {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": `attachment; filename="${name}.xlsx"`,
          "cache-control": "private, no-store",
        },
      });
    const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.map(cell).join(";"), ...data.map((r) => r.map(cell).join(";"))];
    return c.body(`﻿${lines.join("\r\n")}\r\n`, 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}.csv"`,
    });
  }

  return new Hono<AppEnv>()
    .get("/", requirePerm("identity:read"), zValidator("query", ComputerQuery), async (c) => c.json(await list(c, c.req.valid("query"))))
    .get("/export.csv", requirePerm("identity:read"), zValidator("query", ComputerQuery), (c) => exportList(c, "csv"))
    .get("/export.xlsx", requirePerm("identity:read"), zValidator("query", ComputerQuery), (c) => exportList(c, "xlsx"))
    /** Založení / spárování aktiv z vybraných počítačů – vyžaduje i zápis aktiv. */
    .post("/assets", requirePerm("identity:write", "assets:write"), zValidator("json", ComputerAssetsInput), async (c) => {
      const { ids } = c.req.valid("json");
      const rows = await db
        .select({
          id: identityComputers.id,
          companyId: identityComputers.companyId,
          name: identityComputers.name,
          dnsName: identityComputers.dnsName,
          externalId: identityComputers.externalId,
          os: identityComputers.os,
          osVersion: identityComputers.osVersion,
          role: identityComputers.role,
        })
        .from(identityComputers)
        .where(and(inScope(c, identityComputers.companyId), inArray(identityComputers.id, ids), isNull(identityComputers.assetId), isNull(identityComputers.removedAt)));
      const r = await createComputerAssets(db, rows);
      await audit(db, { c, user: currentUser(c), action: "identity.computer_assets", entityType: "identity", details: { requested: ids.length, ...r } });
      return c.json({ ...r, skipped: ids.length - rows.length });
    });
}
