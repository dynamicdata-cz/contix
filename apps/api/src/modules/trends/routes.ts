import { profileOf, FRAMEWORKS, monthRange, periodOf, type TrendDto } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, gte } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requirePerm } from "../../auth/middleware";
import type { AppEnv } from "../../auth/service";
import { settingsFor, soleCompany } from "../../auth/scope";
import type { Db } from "../../db/client";
import { trendSnapshots } from "../../db/schema";
import { takeTrendSnapshot } from "./service";

/** Historie ukazatelů společnosti za posledních N měsíců (ADR-042). Chybí-li snímek běžného měsíce, pořídí se hned. */
export async function loadTrends(db: Db, companyId: string, months: number, now = new Date()): Promise<TrendDto> {
  const range = monthRange(periodOf(now), months);
  let rows = await db
    .select()
    .from(trendSnapshots)
    .where(and(eq(trendSnapshots.companyId, companyId), gte(trendSnapshots.period, range[0]!)))
    .orderBy(asc(trendSnapshots.period));
  if (!rows.some((r) => r.period === periodOf(now))) {
    await takeTrendSnapshot(db, companyId, now);
    rows = await db
      .select()
      .from(trendSnapshots)
      .where(and(eq(trendSnapshots.companyId, companyId), gte(trendSnapshots.period, range[0]!)))
      .orderBy(asc(trendSnapshots.period));
  }
  const s = await settingsFor(db, null, companyId);
  const fwIds = new Set(rows.flatMap((r) => Object.keys(r.values).filter((k) => k.startsWith("compliance:")).map((k) => k.slice(11))));
  return {
    companyId,
    framework: profileOf(s).defaultFramework,
    frameworks: FRAMEWORKS.filter((f) => fwIds.has(f.id)).map((f) => ({ id: f.id, name: f.shortName })),
    points: rows.map((r) => ({ period: r.period, takenAt: r.takenAt.toISOString(), values: r.values })),
  };
}

export function trendRoutes(db: Db) {
  return new Hono<AppEnv>().get(
    "/",
    requirePerm("isms:read", "risks:read", "controls:read"),
    zValidator("query", z.object({ months: z.coerce.number().int().min(2).max(36).default(12), companyId: z.string().uuid().optional() })),
    async (c) => {
      const q = c.req.valid("query");
      return c.json(await loadTrends(db, soleCompany(c, q.companyId), q.months));
    },
  );
}
