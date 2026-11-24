import type { DashboardTechDto, OpsCheck, ScaOverviewDto, SecTestSummaryDto, SocSummaryDto, TlsOverview, UnifiedFindingsDto, ZoneMapDto } from "@contix/shared";
import { Hono } from "hono";
import type { AppEnv } from "../../auth/service";

/* ============================================================
 * Technické karty Přehledu jedním dotazem (v1.102, ADR-196). Souhrn skládá server z existujících rout (stejná
 * oprávnění, moduly a rozsah společnosti jako samostatné obrazovky) – paralelně a uvnitř procesu. Prohlížeč tak
 * posílá jeden požadavek místo sedmi a nestahuje celé seznamy (certifikáty, mapa zón, politiky SCA).
 * ============================================================ */

export type SelfRequest = (path: string, init: RequestInit) => Promise<Response>;

export function dashboardTechRoutes(self: () => SelfRequest) {
  return new Hono<AppEnv>().get("/", async (c) => {
    const headers = new Headers();
    for (const h of ["cookie", "x-contix-company", "accept-language"]) {
      const v = c.req.header(h);
      if (v) headers.set(h, v);
    }
    // nepovolený modul / oprávnění = null (403 / 404); jiné chyby také null, aby jedna karta nepoložila Přehled
    const get = async <T>(path: string): Promise<T | null> => {
      try {
        const r = await self()(path, { headers });
        return r.ok ? ((await r.json()) as T) : null;
      } catch {
        return null;
      }
    };
    const [sectests, findings, zoneMap, tls, soc, sca, ops] = await Promise.all([
      get<SecTestSummaryDto>("/api/security-tests/summary"),
      get<UnifiedFindingsDto>("/api/findings?source=monitoring&limit=50"),
      // mapa zón jen pro jednu společnost – v souhrnu skupiny by se tiše vzala domovská
      c.get("auth")?.scope.active ? get<ZoneMapDto>("/api/zones/map") : Promise.resolve(null),
      get<TlsOverview>("/api/assets/certificates"),
      get<SocSummaryDto>("/api/soc/summary"),
      get<ScaOverviewDto>("/api/sca"),
      get<{ checks: OpsCheck[]; lastSuccessfulBackupAt: string | null }>("/api/ops/status"),
    ]);
    const out: DashboardTechDto = {
      sectests,
      monitoring: findings ? { open: findings.open.monitoring ?? { critical: 0, high: 0, medium: 0, low: 0 } } : null,
      zones: zoneMap
        ? {
            zones: zoneMap.zones.length,
            assigned: zoneMap.assets.filter((a) => a.zoneId).length,
            unassigned: zoneMap.unassigned,
            highFlows: zoneMap.flows.filter((f) => f.level === "high" && !f.control).length,
          }
        : null,
      tls: tls ? { total: tls.summary.total, expired: tls.summary.expired, expiring: tls.summary.expiring, withFindings: tls.summary.withFindings, unscanned: tls.summary.unscanned } : null,
      soc,
      sca: sca ? { totals: sca.totals, policies: sca.policies.length, lastSyncAt: sca.lastSync?.at ?? null } : null,
      ops: ops ? { checks: ops.checks.map((x) => ({ key: x.key, label: x.label, level: x.level })), lastSuccessfulBackupAt: ops.lastSuccessfulBackupAt } : null,
    };
    return c.json(out);
  });
}
