import { CollectorConnectionInput, CollectorInstallerInput, ProbeConnectionInput, JiraConnectionInput, NetboxConnectionInput, WazuhConnectionInput, type ConnectorTestResult } from "@contix/shared";
import { listNetbox, netboxDtos, saveNetbox, testNetbox } from "./netbox";
import { jiraDtos, listJira, saveJira, testJira } from "./jira";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, requirePerm } from "../../auth/middleware";
import { getCompanies } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { connections } from "../../db/schema";
import { testWazuh } from "../discovery/connectors/wazuh";
import { testIndexer } from "../vulnerabilities/sources";
import { getWazuh, saveWazuh, wazuhDtos } from "./wazuh";
import { buildCollectorInstaller, collectorDtos, collectorToken, rotateCollectorToken, saveCollector } from "../collector/service";
import { buildProbeInstaller, probeDtos, probeToken, rotateProbeToken, saveProbe } from "../sectests/service";
import { and } from "drizzle-orm";

/* ============================================================
 * Administrace → Konektory (v1.49, ADR-146): víc instancí Wazuhu, každá s rozsahem a schopnostmi.
 * Tajemství se do UI nevrací; prázdné heslo při úpravě = ponechat uložené.
 * ============================================================ */

const TestInput = WazuhConnectionInput.partial({ name: true }).extend({ id: z.string().uuid().optional() });

export function connectionAdminRoutes(deps: { db: Db; config: Config }) {
  const { db, config } = deps;

  /** Společnost připojení a mapování skupin musí existovat. */
  async function checkScope(i: { companyId?: string | null; groupMap?: { group: string; companyId: string }[] }) {
    const ids = new Set((await getCompanies(db)).map((c) => c.id));
    if (i.companyId && !ids.has(i.companyId)) throw new HTTPException(400, { message: "Neznámá společnost připojení." });
    for (const m of i.groupMap ?? []) if (!ids.has(m.companyId)) throw new HTTPException(400, { message: "Mapování skupin odkazuje na neznámou společnost." });
  }
  const details = (i: z.infer<typeof WazuhConnectionInput>) => ({
    name: i.name,
    url: i.url,
    user: i.user,
    enabled: i.enabled,
    companyId: i.companyId,
    groups: i.groupMap.length,
    passwordChanged: !!i.password,
    indexerUrl: i.indexerUrl,
    indexerPasswordChanged: !!i.indexerPassword,
    alertsEnabled: i.alertsEnabled,
  });

  return new Hono<AppEnv>()
    .get("/", requirePerm("admin:settings"), async (c) => c.json({ wazuh: await wazuhDtos(db, config), collectors: await collectorDtos(db), probes: await probeDtos(db), netbox: await netboxDtos(db, config), jira: await jiraDtos(db, config) }))

    /* ---- NetBox a JIRA (v1.53, ADR-150) ---- */
    .post("/netbox", requirePerm("admin:settings"), zValidator("json", NetboxConnectionInput), async (c) => {
      const i = c.req.valid("json");
      if (!i.token) throw new HTTPException(400, { message: "Zadejte API token NetBoxu" });
      await checkScope(i);
      const id = await saveNetbox(db, config, null, i);
      await audit(db, { c, user: currentUser(c), action: "connection.created", entityType: "connection", entityId: id, details: { kind: "netbox", name: i.name, url: i.url } });
      return c.json({ id, netbox: await netboxDtos(db, config) }, 201);
    })
    .put("/netbox/:id", requirePerm("admin:settings"), zValidator("json", NetboxConnectionInput), async (c) => {
      const id = c.req.param("id");
      if (!(await listNetbox(db, config)).some((x) => x.id === id)) throw new HTTPException(404, { message: "Připojení nenalezeno" });
      const i = c.req.valid("json");
      await checkScope(i);
      await saveNetbox(db, config, id, i);
      await audit(db, { c, user: currentUser(c), action: "connection.updated", entityType: "connection", entityId: id, details: { kind: "netbox", name: i.name, url: i.url, tokenChanged: !!i.token } });
      return c.json({ netbox: await netboxDtos(db, config) });
    })
    .post("/netbox/test", requirePerm("admin:settings"), zValidator("json", NetboxConnectionInput.extend({ id: z.string().uuid().optional() })), async (c) => {
      const i = c.req.valid("json");
      const token = i.token || (i.id ? (await listNetbox(db, config)).find((x) => x.id === i.id)?.token : null);
      if (!token) throw new HTTPException(400, { message: "Zadejte API token NetBoxu" });
      let result: ConnectorTestResult;
      try {
        const r = await testNetbox({ url: i.url.replace(/\/+$/, ""), token, verifyTls: i.verifyTls ?? true });
        result = { ok: true, message: `Připojeno k NetBoxu${r.version ? ` ${r.version}` : ""}: ${r.devices} zařízení${r.vms !== null ? `, ${r.vms} virtuálních strojů` : ""}.`, details: r };
      } catch (e) {
        result = { ok: false, message: (e as Error).message };
      }
      return c.json(result);
    })
    .post("/jira", requirePerm("admin:settings"), zValidator("json", JiraConnectionInput), async (c) => {
      const i = c.req.valid("json");
      if (!i.token) throw new HTTPException(400, { message: "Zadejte API token JIRA" });
      await checkScope(i);
      const id = await saveJira(db, config, null, i);
      await audit(db, { c, user: currentUser(c), action: "connection.created", entityType: "connection", entityId: id, details: { kind: "jira", name: i.name, url: i.url, project: i.projectKey } });
      return c.json({ id, jira: await jiraDtos(db, config) }, 201);
    })
    .put("/jira/:id", requirePerm("admin:settings"), zValidator("json", JiraConnectionInput), async (c) => {
      const id = c.req.param("id");
      if (!(await listJira(db, config)).some((x) => x.id === id)) throw new HTTPException(404, { message: "Připojení nenalezeno" });
      const i = c.req.valid("json");
      await checkScope(i);
      await saveJira(db, config, id, i);
      await audit(db, { c, user: currentUser(c), action: "connection.updated", entityType: "connection", entityId: id, details: { kind: "jira", name: i.name, url: i.url, project: i.projectKey, tokenChanged: !!i.token } });
      return c.json({ jira: await jiraDtos(db, config) });
    })
    .post("/jira/test", requirePerm("admin:settings"), zValidator("json", JiraConnectionInput.extend({ id: z.string().uuid().optional() })), async (c) => {
      const i = c.req.valid("json");
      const token = i.token || (i.id ? (await listJira(db, config)).find((x) => x.id === i.id)?.token : null);
      if (!token) throw new HTTPException(400, { message: "Zadejte API token JIRA" });
      let result: ConnectorTestResult;
      try {
        const r = await testJira({ ...i, token });
        result = { ok: true, message: `Připojeno k JIRA jako ${r.user ?? "?"}, projekt ${r.project}.`, details: r };
      } catch (e) {
        result = { ok: false, message: (e as Error).message };
      }
      return c.json(result);
    })
    /** Smazání připojení NetBox / JIRA (vazby aktiv a issue zaniknou, aktiva a úkoly zůstanou). */
    .delete("/:kind{netbox|jira}/:id", requirePerm("admin:settings"), async (c) => {
      const [row] = await db.select().from(connections).where(and(eq(connections.id, c.req.param("id")), eq(connections.kind, c.req.param("kind"))));
      if (!row) throw new HTTPException(404, { message: "Připojení nenalezeno" });
      await db.delete(connections).where(eq(connections.id, row.id));
      await audit(db, { c, user: currentUser(c), action: "connection.deleted", entityType: "connection", entityId: row.id, details: { kind: row.kind, name: row.name } });
      return c.json({ ok: true });
    })

    /* ---- sběrač ze serverů (v1.51, ADR-148): token se ukáže jen jednou ---- */
    .post("/collector", requirePerm("admin:settings"), zValidator("json", CollectorConnectionInput), async (c) => {
      const input = c.req.valid("json");
      await checkScope(input);
      const r = await saveCollector(db, config, null, input);
      await audit(db, { c, user: currentUser(c), action: "connection.created", entityType: "connection", entityId: r.id, details: { kind: "collector", name: input.name, companyId: input.companyId } });
      return c.json({ id: r.id, token: r.token, collectors: await collectorDtos(db) }, 201);
    })
    .put("/collector/:id", requirePerm("admin:settings"), zValidator("json", CollectorConnectionInput), async (c) => {
      const id = c.req.param("id");
      if (!(await collectorDtos(db)).some((x) => x.id === id)) throw new HTTPException(404, { message: "Připojení nenalezeno" });
      const input = c.req.valid("json");
      await checkScope(input);
      await saveCollector(db, config, id, input);
      await audit(db, { c, user: currentUser(c), action: "connection.updated", entityType: "connection", entityId: id, details: { kind: "collector", name: input.name, enabled: input.enabled, companyId: input.companyId } });
      return c.json({ collectors: await collectorDtos(db) });
    })
    .post("/collector/:id/token", requirePerm("admin:settings"), async (c) => {
      const id = c.req.param("id");
      if (!(await collectorDtos(db)).some((x) => x.id === id)) throw new HTTPException(404, { message: "Připojení nenalezeno" });
      const token = await rotateCollectorToken(db, config, id);
      await audit(db, { c, user: currentUser(c), action: "connection.token_rotated", entityType: "connection", entityId: id });
      return c.json({ token, collectors: await collectorDtos(db) });
    })
    .delete("/collector/:id", requirePerm("admin:settings"), async (c) => {
      const id = c.req.param("id");
      const [row] = await db.select().from(connections).where(and(eq(connections.id, id), eq(connections.kind, "collector")));
      if (!row) throw new HTTPException(404, { message: "Připojení nenalezeno" });
      await db.delete(connections).where(eq(connections.id, id));
      await audit(db, { c, user: currentUser(c), action: "connection.deleted", entityType: "connection", entityId: id, details: { kind: "collector", name: row.name } });
      return c.json({ collectors: await collectorDtos(db) });
    })
    /** Instalátor (v1.54, ADR-151): jeden skript se sběračem, adresou, tokenem, CA a cronem; nastavení se zapamatuje. */
    .post("/collector/:id/installer", requirePerm("admin:settings"), zValidator("json", CollectorInstallerInput), async (c) => {
      const [row] = await db.select().from(connections).where(and(eq(connections.id, c.req.param("id")), eq(connections.kind, "collector")));
      if (!row) throw new HTTPException(404, { message: "Připojení nenalezeno" });
      const token = collectorToken(row, config);
      if (!token) throw new HTTPException(409, { message: "Token tohoto připojení není uložen (vznikl před verzí 1.54) – vygenerujte nový token a stáhněte instalátor znovu." });
      const i = c.req.valid("json");
      const url = (i.url ?? config.APP_URL).replace(/\/+$/, "");
      await db.update(connections).set({ config: { ...(row.config as Record<string, unknown>), hostsIp: i.hostsIp, caPem: i.caPem }, updatedAt: new Date() }).where(eq(connections.id, row.id));
      const script = await Bun.file(new URL("../collector/contix-collect.py", import.meta.url)).text();
      const body = buildCollectorInstaller({ name: row.name, url, token, script, hostsIp: i.hostsIp ?? "", caPem: i.caPem ?? "", everyHours: i.everyHours ?? 6 });
      await audit(db, { c, user: currentUser(c), action: "connection.installer_downloaded", entityType: "connection", entityId: row.id, details: { name: row.name, url, hostsIp: i.hostsIp || null, ca: !!i.caPem } });
      return c.body(body, 200, { "content-type": "text/x-shellscript; charset=utf-8", "content-disposition": 'attachment; filename="install-contix-collect.sh"', "cache-control": "no-store" });
    })
    /* ---- sonda bezpečnostních testů (v1.56, ADR-153) ---- */
    .post("/probe", requirePerm("admin:settings"), zValidator("json", ProbeConnectionInput), async (c) => {
      const input = c.req.valid("json");
      await checkScope(input);
      const r = await saveProbe(db, config, null, input);
      await audit(db, { c, user: currentUser(c), action: "connection.created", entityType: "connection", entityId: r.id, details: { kind: "probe", name: input.name, companyId: input.companyId } });
      return c.json({ id: r.id, token: r.token, probes: await probeDtos(db) }, 201);
    })
    .put("/probe/:id", requirePerm("admin:settings"), zValidator("json", ProbeConnectionInput), async (c) => {
      const id = c.req.param("id");
      if (!(await probeDtos(db)).some((x) => x.id === id)) throw new HTTPException(404, { message: "Připojení nenalezeno" });
      const input = c.req.valid("json");
      await checkScope(input);
      await saveProbe(db, config, id, input);
      await audit(db, { c, user: currentUser(c), action: "connection.updated", entityType: "connection", entityId: id, details: { kind: "probe", name: input.name, enabled: input.enabled, companyId: input.companyId } });
      return c.json({ probes: await probeDtos(db) });
    })
    .post("/probe/:id/token", requirePerm("admin:settings"), async (c) => {
      const id = c.req.param("id");
      if (!(await probeDtos(db)).some((x) => x.id === id)) throw new HTTPException(404, { message: "Připojení nenalezeno" });
      const token = await rotateProbeToken(db, config, id);
      await audit(db, { c, user: currentUser(c), action: "connection.token_rotated", entityType: "connection", entityId: id });
      return c.json({ token, probes: await probeDtos(db) });
    })
    .post("/probe/:id/installer", requirePerm("admin:settings"), zValidator("json", CollectorInstallerInput), async (c) => {
      const [row] = await db.select().from(connections).where(and(eq(connections.id, c.req.param("id")), eq(connections.kind, "probe")));
      if (!row) throw new HTTPException(404, { message: "Připojení nenalezeno" });
      const token = probeToken(row, config);
      if (!token) throw new HTTPException(409, { message: "Token sondy není uložen – vygenerujte nový token." });
      const i = c.req.valid("json");
      const url = (i.url ?? config.APP_URL).replace(/\/+$/, "");
      const script = await Bun.file(new URL("../sectests/contix-probe.py", import.meta.url)).text();
      const body = buildProbeInstaller({ name: row.name, url, token, script, caPem: i.caPem ?? "" });
      await audit(db, { c, user: currentUser(c), action: "connection.installer_downloaded", entityType: "connection", entityId: row.id, details: { kind: "probe", name: row.name, url } });
      return c.body(body, 200, { "content-type": "text/x-shellscript; charset=utf-8", "content-disposition": 'attachment; filename="install-contix-probe.sh"', "cache-control": "no-store" });
    })
    .delete("/probe/:id", requirePerm("admin:settings"), async (c) => {
      const [row] = await db.select().from(connections).where(and(eq(connections.id, c.req.param("id")), eq(connections.kind, "probe")));
      if (!row) throw new HTTPException(404, { message: "Připojení nenalezeno" });
      await db.delete(connections).where(eq(connections.id, row.id));
      await audit(db, { c, user: currentUser(c), action: "connection.deleted", entityType: "connection", entityId: row.id, details: { kind: "probe", name: row.name } });
      return c.json({ probes: await probeDtos(db) });
    })
    /** Skript sběrače ke stažení (Python 3, jen čte). */
    .get("/collector/script", requirePerm("admin:settings"), async (c) => {
      const body = await Bun.file(new URL("../collector/contix-collect.py", import.meta.url)).text();
      return c.body(body, 200, { "content-type": "text/x-python; charset=utf-8", "content-disposition": 'attachment; filename="contix-collect.py"' });
    })

    .post("/wazuh", requirePerm("admin:settings"), zValidator("json", WazuhConnectionInput), async (c) => {
      const input = c.req.valid("json");
      if (!input.password) throw new HTTPException(400, { message: "Zadejte heslo k Wazuh API" });
      await checkScope(input);
      const id = await saveWazuh(db, config, null, input);
      await audit(db, { c, user: currentUser(c), action: "connection.created", entityType: "connection", entityId: id, details: details(input) });
      return c.json({ id, wazuh: await wazuhDtos(db, config) }, 201);
    })

    .put("/wazuh/:id", requirePerm("admin:settings"), zValidator("json", WazuhConnectionInput), async (c) => {
      const id = c.req.param("id");
      if (!(await getWazuh(db, config, id))) throw new HTTPException(404, { message: "Připojení nenalezeno" });
      const input = c.req.valid("json");
      await checkScope(input);
      await saveWazuh(db, config, id, input);
      await audit(db, { c, user: currentUser(c), action: "connection.updated", entityType: "connection", entityId: id, details: details(input) });
      return c.json({ id, wazuh: await wazuhDtos(db, config) });
    })

    /** Smazání: vazby agentů na aktiva zaniknou (aktiva, zranitelnosti a alerty zůstanou). */
    .delete("/wazuh/:id", requirePerm("admin:settings"), async (c) => {
      const w = await getWazuh(db, config, c.req.param("id"));
      if (!w) throw new HTTPException(404, { message: "Připojení nenalezeno" });
      await db.delete(connections).where(eq(connections.id, w.id));
      await audit(db, { c, user: currentUser(c), action: "connection.deleted", entityType: "connection", entityId: w.id, details: { name: w.name, url: w.url } });
      return c.json({ wazuh: await wazuhDtos(db, config) });
    })

    /** Test s hodnotami z formuláře; prázdné heslo = uložené heslo připojení `id`. */
    .post("/wazuh/test", requirePerm("admin:settings"), zValidator("json", TestInput), async (c) => {
      const input = c.req.valid("json");
      const stored = input.id ? await getWazuh(db, config, input.id) : null;
      const password = input.password || stored?.password;
      if (!password) throw new HTTPException(400, { message: "Zadejte heslo k Wazuh API" });
      let result: ConnectorTestResult;
      try {
        const r = await testWazuh({ url: input.url, user: input.user, password, verifyTls: input.verifyTls });
        result = { ok: true, message: `Připojeno k Wazuh API${r.apiVersion ? ` ${r.apiVersion}` : ""}: ${r.agents} agentů${r.activeAgents !== null ? ` (${r.activeAgents} aktivních)` : ""}.`, details: r };
      } catch (e) {
        result = { ok: false, message: (e as Error).message };
      }
      await audit(db, { c, user: currentUser(c), action: "connector.tested", entityType: "connection", entityId: input.id ?? "new", details: { ok: result.ok } });
      return c.json(result);
    })

    .post("/wazuh/indexer-test", requirePerm("admin:settings"), zValidator("json", TestInput), async (c) => {
      const input = c.req.valid("json");
      const stored = input.id ? await getWazuh(db, config, input.id) : null;
      const password = input.indexerPassword || stored?.indexerPassword;
      if (!input.indexerUrl || !input.indexerUser) throw new HTTPException(400, { message: "Vyplňte URL a uživatele Wazuh Indexeru" });
      if (!password) throw new HTTPException(400, { message: "Zadejte heslo k Wazuh Indexeru" });
      let result: ConnectorTestResult;
      try {
        const r = await testIndexer({ url: input.indexerUrl, user: input.indexerUser, password, verifyTls: input.indexerVerifyTls, indexPattern: input.indexPattern });
        result = { ok: true, message: `Připojeno k Wazuh Indexeru: ${r.count} záznamů o zranitelnostech v ${input.indexPattern}.`, details: r };
      } catch (e) {
        result = { ok: false, message: (e as Error).message };
      }
      await audit(db, { c, user: currentUser(c), action: "connector.tested", entityType: "connection", entityId: input.id ?? "new", details: { ok: result.ok, indexer: true } });
      return c.json(result);
    });
}
