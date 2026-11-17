import { NetworkScanRequest } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { discoveryRuns } from "../../db/schema";
import { recomputeHealth } from "../vulnerabilities/service";
import { startWazuhSync, wazuhRunning } from "./wazuhSync";
import { csvConnector } from "./connectors/csv";
import { assertTargetsAllowed, createNmapConnector } from "./connectors/nmap";
import { getScanConfig, nmapInfo, scanReady } from "../connectors/config";
import { listWazuh, wazuhApiReady } from "../connections/wazuh";
import { listNetbox, netboxRunning, startNetboxSync } from "../connections/netbox";
import { startRun } from "./runner";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { audit, type AppEnv } from "../../auth/service";
import { assertScope, inScope, scopeOf, targetCompany } from "../../auth/scope";
import { tFor } from "../i18n/service";

export function discoveryRoutes(db: Db, config: Config) {
  return new Hono<AppEnv>()
    .use("*", requireModule(db, "discovery"))
    .use("*", requirePerm("assets:read"))
    .get("/connectors", async (c) => {
      const [ws, sc] = await Promise.all([listWazuh(db, config), getScanConfig(db, config)]);
      const ready = ws.filter((w) => wazuhApiReady(w) && (!w.companyId || scopeOf(c).ids.includes(w.companyId)));
      const nmap = await nmapInfo(sc.nmapPath);
      const scanOk = scanReady(sc) && !!nmap.found;
      const t = await tFor(db, c);
      return c.json([
        { id: "manual", label: t("srv.disc.conn.manual"), enabled: true },
        {
          id: "wazuh",
          label: "Wazuh",
          enabled: ready.length > 0,
          detail: ready.length ? ready.map((w) => (ws.length > 1 ? `${w.name} (${w.url})` : w.url)).join(", ") : !ws.length ? t("srv.disc.conn.wazuhNotSet") : t("srv.disc.conn.wazuhOff"),
          // víc Wazuhů (ADR-146): synchronizace jednoho nebo všech
          connections: ready.map((w) => ({ id: w.id, name: w.name, url: w.url })),
        },
        {
          id: "network_scan",
          label: t("srv.disc.conn.scan"),
          enabled: scanOk,
          allowedCidrs: sc.allowedCidrs,
          detail: !sc.enabled
            ? t("srv.disc.conn.scanOff")
            : !sc.allowedCidrs.length
              ? t("srv.disc.conn.noRanges")
              : !nmap.found
                ? t("srv.disc.conn.noNmap")
                : t("srv.disc.conn.ranges", { ranges: sc.allowedCidrs.join(", ") }),
        },
        { id: "csv_import", label: t("srv.disc.conn.csv"), enabled: true },
        ...(await listNetbox(db, config)).filter((n) => n.enabled && n.token).length
          ? [{ id: "netbox", label: "NetBox", enabled: true, detail: (await listNetbox(db, config)).filter((n) => n.enabled && n.token).map((n) => n.url).join(", "), connections: (await listNetbox(db, config)).filter((n) => n.enabled && n.token).map((n) => ({ id: n.id, name: n.name, url: n.url })) }]
          : [],
      ]);
    })

    .get("/runs", async (c) => {
      const rows = await db.select().from(discoveryRuns).where(inScope(c, discoveryRuns.companyId)).orderBy(desc(discoveryRuns.createdAt)).limit(50);
      return c.json(rows);
    })

    .get("/runs/:id", async (c) => {
      const [row] = await db.select().from(discoveryRuns).where(eq(discoveryRuns.id, c.req.param("id")));
      if (!row) throw new HTTPException(404, { message: "Běh nenalezen" });
      assertScope(c, row.companyId, "Běh nenalezen");
      return c.json(row);
    })

    /** Synchronizace jednoho připojení (`connectionId`), jinak všech připojení v rozsahu uživatele. */
    .post("/wazuh", requirePerm("discovery:run"), async (c) => {
      const body = ((await c.req.json().catch(() => ({}))) ?? {}) as { connectionId?: unknown };
      const wanted = typeof body.connectionId === "string" ? body.connectionId : null;
      const ids = scopeOf(c).ids;
      const ws = (await listWazuh(db, config)).filter((w) => wazuhApiReady(w) && (!w.companyId || ids.includes(w.companyId)) && (!wanted || w.id === wanted));
      if (!ws.length) throw new HTTPException(400, { message: "Wazuh konektor není nastaven (Administrace → Konektory)." });
      const runIds: string[] = [];
      for (const w of ws) {
        if (await wazuhRunning(db, w.id)) {
          if (wanted || ws.length === 1) throw new HTTPException(409, { message: "Synchronizace s Wazuhem už běží." });
          continue;
        }
        const { runId } = await startWazuhSync(db, w, targetCompany(c), "manual");
        await audit(db, { c, user: currentUser(c), action: "discovery.started", entityType: "discovery_run", entityId: runId, details: { connector: "wazuh", connection: w.name } });
        runIds.push(runId);
      }
      return c.json({ runId: runIds[0], runIds }, 202);
    })

    /** NetBox (v1.53): synchronizace jednoho připojení, jinak všech v rozsahu. */
    .post("/netbox", requirePerm("discovery:run"), async (c) => {
      const body = ((await c.req.json().catch(() => ({}))) ?? {}) as { connectionId?: unknown };
      const wanted = typeof body.connectionId === "string" ? body.connectionId : null;
      const ids = scopeOf(c).ids;
      const list = (await listNetbox(db, config)).filter((n) => n.enabled && n.token && (!n.companyId || ids.includes(n.companyId)) && (!wanted || n.id === wanted));
      if (!list.length) throw new HTTPException(400, { message: "NetBox není nastaven (Administrace → Konektory)." });
      const runIds: string[] = [];
      for (const n of list) {
        if (await netboxRunning(db, n.id)) continue;
        const { runId } = await startNetboxSync(db, n, targetCompany(c), "manual");
        await audit(db, { c, user: currentUser(c), action: "discovery.started", entityType: "discovery_run", entityId: runId, details: { connector: "netbox", connection: n.name } });
        runIds.push(runId);
      }
      if (!runIds.length) throw new HTTPException(409, { message: "Synchronizace s NetBoxem už běží." });
      return c.json({ runId: runIds[0], runIds }, 202);
    })

    .post("/network-scan", requirePerm("discovery:run"), zValidator("json", NetworkScanRequest), async (c) => {
      const sc = await getScanConfig(db, config);
      if (!scanReady(sc)) throw new HTTPException(403, { message: "Síťový sken je vypnutý (Administrace → Konektory)." });
      const body = c.req.valid("json");
      try {
        assertTargetsAllowed(body.targets, sc.allowedCidrs);
      } catch (e) {
        throw new HTTPException(400, { message: (e as Error).message });
      }
      if (!(await nmapInfo(sc.nmapPath)).found) throw new HTTPException(400, { message: "nmap není nainstalovaný na serveru." });
      const connector = createNmapConnector({ nmapPath: sc.nmapPath, allowedCidrs: sc.allowedCidrs });
      const { runId } = await startRun(
        db,
        "network_scan",
        connector,
        body,
        body,
        async () => {
          await recomputeHealth(db);
          return {};
        },
        targetCompany(c),
      );
      await audit(db, { c, user: currentUser(c), action: "discovery.started", entityType: "discovery_run", entityId: runId, details: { connector: "network_scan", ...body } });
      return c.json({ runId }, 202);
    })

    .post("/import/csv", requirePerm("discovery:run"), async (c) => {
      const type = c.req.header("content-type") ?? "";
      let content: string;
      let fileName = "import.csv";
      if (type.startsWith("multipart/form-data")) {
        const form = await c.req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) throw new HTTPException(400, { message: 'Chybí soubor "file".' });
        if (file.size > 10 * 1024 * 1024) throw new HTTPException(413, { message: "Soubor je větší než 10 MB." });
        content = await file.text();
        fileName = file.name;
      } else {
        content = await c.req.text();
      }
      const { runId, done } = await startRun(
        db,
        "csv_import",
        csvConnector,
        { content, fileName },
        { fileName },
        async () => {
          await recomputeHealth(db);
          return {};
        },
        targetCompany(c),
      );
      await done; // import je rychlý – počkáme na výsledek
      await audit(db, { c, user: currentUser(c), action: "discovery.import", entityType: "discovery_run", entityId: runId, details: { fileName } });
      const [run] = await db.select().from(discoveryRuns).where(eq(discoveryRuns.id, runId));
      return c.json(run, 201);
    });
}
