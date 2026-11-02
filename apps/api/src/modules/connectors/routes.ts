import { ScanSettingsInput, WazuhSettingsInput, type ConnectorTestResult } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, requirePerm } from "../../auth/middleware";
import { audit, type AppEnv } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { parseCidr } from "../discovery/connectors/nmap";
import { testWazuh } from "../discovery/connectors/wazuh";
import { testIndexer } from "../vulnerabilities/sources";
import {
  connectorSettingsDto,
  getWazuhConfig,
  nmapInfo,
  normalizeWazuh,
  saveScanConfig,
  saveWazuhConfig,
} from "./config";
import { ApiError } from "../../lib/apiError";

/** Administrace → Konektory (Wazuh, síťový sken). */
export function connectorAdminRoutes(deps: { db: Db; config: Config }) {
  const { db, config } = deps;

  return new Hono<AppEnv>()
    .use("*", requirePerm("admin:settings"))

    .get("/", async (c) => c.json(await connectorSettingsDto(db, config)))

    .put("/wazuh", zValidator("json", WazuhSettingsInput), async (c) => {
      const input = normalizeWazuh(c.req.valid("json"));
      await saveWazuhConfig(db, config, input);
      await audit(db, {
        c,
        user: currentUser(c),
        action: "connector.updated",
        entityType: "connector",
        entityId: "wazuh",
        details: {
          url: input.url,
          user: input.user,
          enabled: input.enabled,
          verifyTls: input.verifyTls,
          passwordChanged: !!input.password,
          vulnEnabled: input.vulnEnabled,
          indexerUrl: input.indexerUrl,
          indexerUser: input.indexerUser,
          indexerPasswordChanged: !!input.indexerPassword,
        },
      });
      return c.json(await connectorSettingsDto(db, config));
    })

    /** Test s hodnotami z formuláře; prázdné heslo = použije se uložené. */
    .post("/wazuh/test", zValidator("json", WazuhSettingsInput), async (c) => {
      const input = normalizeWazuh(c.req.valid("json"));
      const stored = await getWazuhConfig(db, config);
      const password = input.password ?? stored.password;
      if (!password) throw new HTTPException(400, { message: "Zadejte heslo k Wazuh API" });
      let result: ConnectorTestResult;
      try {
        const r = await testWazuh({ url: input.url, user: input.user, password, verifyTls: input.verifyTls });
        result = {
          ok: true,
          message: `Připojeno k Wazuh API${r.apiVersion ? ` ${r.apiVersion}` : ""}: ${r.agents} agentů${r.activeAgents !== null ? ` (${r.activeAgents} aktivních)` : ""}.`,
          details: r,
        };
      } catch (e) {
        result = { ok: false, message: (e as Error).message };
      }
      await audit(db, { c, user: currentUser(c), action: "connector.tested", entityType: "connector", entityId: "wazuh", details: { ok: result.ok } });
      return c.json(result);
    })

    /** Test Wazuh Indexeru (zranitelnosti, Wazuh 4.8+). */
    .post("/wazuh/indexer-test", zValidator("json", WazuhSettingsInput), async (c) => {
      const input = normalizeWazuh(c.req.valid("json"));
      const stored = await getWazuhConfig(db, config);
      const password = input.indexerPassword ?? stored.indexerPassword;
      if (!input.indexerUrl || !input.indexerUser) throw new HTTPException(400, { message: "Vyplňte URL a uživatele Wazuh Indexeru" });
      if (!password) throw new HTTPException(400, { message: "Zadejte heslo k Wazuh Indexeru" });
      let result: ConnectorTestResult;
      try {
        const r = await testIndexer({
          url: input.indexerUrl,
          user: input.indexerUser,
          password,
          verifyTls: input.indexerVerifyTls,
          indexPattern: input.indexPattern,
        });
        result = { ok: true, message: `Připojeno k Wazuh Indexeru: ${r.count} záznamů o zranitelnostech v ${input.indexPattern}.`, details: r };
      } catch (e) {
        result = { ok: false, message: (e as Error).message };
      }
      await audit(db, { c, user: currentUser(c), action: "connector.tested", entityType: "connector", entityId: "wazuh_indexer", details: { ok: result.ok } });
      return c.json(result);
    })

    .put("/network-scan", zValidator("json", ScanSettingsInput), async (c) => {
      const input = c.req.valid("json");
      const cidrs = [...new Set(input.allowedCidrs.map((x) => x.trim()).filter(Boolean))];
      for (const cidr of cidrs) {
        const r = parseCidr(cidr);
        if (!r) throw new ApiError(400, "err.connectors.badRange", { cidr: String(cidr) });
        if (r.end - r.start + 1 > 65536) throw new ApiError(400, "err.connectors.rangeTooLarge", { cidr: String(cidr) });
      }
      if (input.enabled && !cidrs.length)
        throw new HTTPException(400, { message: "Pro zapnutí skenu zadejte alespoň jeden povolený rozsah." });
      const value = { enabled: input.enabled, allowedCidrs: cidrs, nmapPath: input.nmapPath ?? "nmap" };
      await saveScanConfig(db, value);
      await audit(db, { c, user: currentUser(c), action: "connector.updated", entityType: "connector", entityId: "network_scan", details: value });
      return c.json(await connectorSettingsDto(db, config));
    })

    .post("/network-scan/test", zValidator("json", ScanSettingsInput.pick({ nmapPath: true })), async (c) => {
      const n = await nmapInfo(c.req.valid("json").nmapPath ?? "nmap");
      const result: ConnectorTestResult = n.found
        ? { ok: true, message: `nmap ${n.version ?? ""} nalezen: ${n.found}`, details: n }
        : { ok: false, message: "nmap nebyl nalezen. Na Macu: brew install nmap, na Linuxu: apt install nmap." };
      return c.json(result);
    });
}
