import type { AssetType } from "@contix/shared";
import type { Connector, DiscoveredAsset } from "../types";

/**
 * Konektor na Wazuh Server API (Wazuh manager, typicky https://wazuh:55000).
 *
 * Používá endpointy:
 *   POST /security/user/authenticate      – JWT token (basic auth)
 *   GET  /agents                          – seznam agentů (stránkováno)
 *   GET  /syscollector/{id}/os|hardware|netiface|netaddr|packages – inventář agenta
 *
 * Doporučení: v Wazuhu vytvořit read-only uživatele s rolí jen pro agents:read a syscollector:read.
 */

export interface WazuhParams {
  url: string;
  user: string;
  password: string;
  verifyTls?: boolean;
  includePackages?: boolean;
  /** Jen agenti ve stavu active (výchozí false = všichni kromě never_connected). */
  onlyActive?: boolean;
  pageSize?: number;
}

export type FetchLike = (input: string, init?: RequestInit & { tls?: { rejectUnauthorized?: boolean } }) => Promise<Response>;

interface WazuhAgent {
  id: string;
  name: string;
  ip?: string;
  status?: string;
  version?: string;
  group?: string[];
  lastKeepAlive?: string;
  os?: { name?: string; version?: string; platform?: string; arch?: string };
}


/** Srozumitelný popis síťové chyby (Bun fetch) – včetně rad pro macOS. */
export function describeFetchError(e: unknown, url: string, service: "Wazuh API" | "Wazuh Indexer" = "Wazuh API"): string {
  const err = e as { code?: string; name?: string; message?: string };
  const code = String(err.code ?? err.name ?? "");
  const msg = err.message ?? String(e);
  let host = url;
  try {
    host = new URL(url).host;
  } catch {}
  if (/certificate|self.signed|UNABLE_TO_VERIFY|DEPTH_ZERO|CERT_/i.test(`${code} ${msg}`))
    return `TLS certifikát Wazuhu nelze ověřit (${msg}). Pro test lze vypnout „Ověřovat TLS certifikát“.`;
  if (code === "FailedToOpenSocket" || /typo in the url/i.test(msg))
    return `Nelze otevřít spojení na ${host} – počítač se do této sítě nedostane. Zkontrolujte VPN / síť. Na macOS povolte Terminálu přístup k místní síti: Nastavení systému → Soukromí a zabezpečení → Místní síť. [${code || "FailedToOpenSocket"}]`;
  if (code === "ConnectionRefused")
    return service === "Wazuh Indexer"
      ? `Server ${host} spojení odmítl – Wazuh Indexer na tomto portu nenaslouchá z počítače s CONTIXem. Typicky poslouchá jen na 127.0.0.1 (all-in-one instalace) nebo ho blokuje firewall – viz nápověda „Indexer odmítá spojení“. [${code}]`
      : `Server ${host} spojení odmítl – Wazuh API na tomto portu neběží nebo ho blokuje firewall (ověřte port 55000 a službu wazuh-manager). [${code}]`;
  if (code === "TimeoutError" || code === "23" || /timed out/i.test(msg))
    return `Vypršel časový limit při připojení k ${host} – pravděpodobně firewall nebo špatná adresa. [timeout]`;
  if (code === "ConnectionClosed" || /closed|reset/i.test(msg))
    return `Spojení s ${host} bylo ukončeno – zkontrolujte, že URL začíná https:// a míří na Wazuh API (port 55000). [${code}]`;
  return `${service} (${host}) není dostupné: ${msg}${code ? ` [${code}]` : ""}`;
}

async function wazuhFetch(fetchImpl: FetchLike, url: string, init: Parameters<FetchLike>[1], timeoutMs = 30_000) {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new Error(describeFetchError(e, url));
  }
}

/**
 * Čas posledního spojení agenta. Wazuh manager (agent 000) hlásí „9999-12-31T23:59:59Z“ (vždy aktivní) –
 * takové a jiné budoucí / neplatné hodnoty se nahradí časem synchronizace.
 */
export function keepAliveDate(v: string | undefined | null, now = new Date()): Date {
  const d = v ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime()) || d.getTime() > now.getTime() + 86_400_000) return now;
  return d;
}

export function guessAssetType(osName?: string | null, platform?: string | null): AssetType {
  const s = `${osName ?? ""} ${platform ?? ""}`.toLowerCase();
  if (s.includes("windows")) return s.includes("server") ? "server" : "workstation";
  if (s.includes("darwin") || s.includes("macos")) return "workstation";
  if (s.includes("android") || s.includes("ios")) return "mobile_device";
  if (s.trim()) return "server"; // Linux / Unix
  return "other";
}

export function createWazuhConnector(fetchImpl: FetchLike = fetch as FetchLike): Connector<WazuhParams> {
  return {
    id: "wazuh",
    async *collect(p, ctx) {
      const base = p.url.replace(/\/+$/, "");
      const tls = p.verifyTls === false ? { rejectUnauthorized: false } : undefined;

      const authRes = await wazuhFetch(fetchImpl, `${base}/security/user/authenticate`, {
        method: "POST",
        headers: { Authorization: `Basic ${btoa(`${p.user}:${p.password}`)}` },
        tls,
      });
      if (authRes.status === 401) throw new Error("Wazuh odmítl přihlášení – zkontrolujte uživatele a heslo API.");
      if (!authRes.ok) throw new Error(`Wazuh autentizace selhala: HTTP ${authRes.status}`);
      const token: string = ((await authRes.json()) as any).data.token;
      ctx.log(`přihlášeno k ${base}`);

      const get = async <T = any>(path: string): Promise<{ items: T[]; total: number }> => {
        const res = await wazuhFetch(fetchImpl, `${base}${path}`, { headers: { Authorization: `Bearer ${token}` }, tls });
        if (!res.ok) throw new Error(`Wazuh ${path}: HTTP ${res.status}`);
        const body = (await res.json()) as any;
        return { items: body.data?.affected_items ?? [], total: body.data?.total_affected_items ?? 0 };
      };
      const safe = async <T = any>(path: string) => {
        try {
          return (await get<T>(path)).items;
        } catch (e) {
          ctx.log(`varování: ${(e as Error).message}`);
          return [] as T[];
        }
      };

      const pageSize = p.pageSize ?? 500;
      const status = p.onlyActive ? "&status=active" : "";
      for (let offset = 0; ; offset += pageSize) {
        const page = await get<WazuhAgent>(`/agents?limit=${pageSize}&offset=${offset}${status}`);
        ctx.log(`Wazuh: agenti ${offset + 1}–${offset + page.items.length} z ${page.total}`);

        for (const agent of page.items) {
          if (agent.status === "never_connected") continue;
          const [os] = await safe<any>(`/syscollector/${agent.id}/os`);
          const [hw] = await safe<any>(`/syscollector/${agent.id}/hardware`);
          const ifaces = await safe<any>(`/syscollector/${agent.id}/netiface`);
          const addrs = await safe<any>(`/syscollector/${agent.id}/netaddr`);
          const pkgs = p.includePackages ? await safe<any>(`/syscollector/${agent.id}/packages?limit=10000`) : undefined;

          const osName: string | undefined = os?.os?.name ?? agent.os?.name;
          const ips = [
            ...new Set(
              [agent.ip, ...addrs.map((a: any) => a.address)].filter(
                (ip): ip is string => !!ip && ip !== "any" && !ip.startsWith("127.") && ip !== "::1",
              ),
            ),
          ];
          const macs = [
            ...new Set(ifaces.map((i: any) => i.mac).filter((m: string | undefined) => m && m !== "00:00:00:00:00:00")),
          ] as string[];

          const item: DiscoveredAsset = {
            sourceType: "wazuh",
            sourceRef: agent.id,
            name: os?.hostname ?? agent.name,
            assetType: guessAssetType(osName, os?.os?.platform ?? agent.os?.platform),
            hostname: os?.hostname ?? agent.name,
            ipAddresses: ips,
            macAddresses: macs,
            osName: osName ?? null,
            osVersion: os?.os?.version ?? agent.os?.version ?? null,
            serialNumber: hw?.board_serial ?? null,
            attributes: {
              wazuh: {
                agentId: agent.id,
                status: agent.status,
                version: agent.version,
                groups: agent.group,
                lastKeepAlive: agent.lastKeepAlive,
              },
              cpu: hw?.cpu?.name,
              cpuCores: hw?.cpu?.cores,
              ramKb: hw?.ram?.total,
              arch: os?.architecture ?? agent.os?.arch,
            },
            software: pkgs?.map((k: any) => ({ name: k.name, version: k.version, vendor: k.vendor })),
            raw: { agent, os, hardware: hw },
            seenAt: keepAliveDate(agent.lastKeepAlive),
          };
          yield item;
        }
        if (offset + page.items.length >= page.total || page.items.length === 0) break;
      }
    },
  };
}

/** Ověření připojení: autentizace, verze API a počet agentů. */
export async function testWazuh(
  p: Pick<WazuhParams, "url" | "user" | "password" | "verifyTls">,
  fetchImpl: FetchLike = fetch as FetchLike,
): Promise<{ apiVersion: string | null; agents: number; activeAgents: number | null }> {
  const base = p.url.replace(/\/+$/, "");
  const tls = p.verifyTls === false ? { rejectUnauthorized: false } : undefined;
  const authRes = await wazuhFetch(
    fetchImpl,
    `${base}/security/user/authenticate`,
    { method: "POST", headers: { Authorization: `Basic ${btoa(`${p.user}:${p.password}`)}` }, tls },
    10_000,
  );
  if (authRes.status === 401) throw new Error("Wazuh odmítl přihlášení – zkontrolujte uživatele a heslo.");
  if (!authRes.ok) throw new Error(`Wazuh autentizace selhala: HTTP ${authRes.status}`);
  const token: string = ((await authRes.json()) as any).data.token;
  const get = async (path: string) => {
    const r = await wazuhFetch(fetchImpl, `${base}${path}`, { headers: { Authorization: `Bearer ${token}` }, tls }, 10_000);
    if (!r.ok) throw new Error(`Wazuh ${path}: HTTP ${r.status} – má účet oprávnění agents:read?`);
    return (await r.json()) as any;
  };
  const info = await get("/").catch(() => null);
  const all = await get("/agents?limit=1&select=id");
  const active = await get("/agents?limit=1&select=id&status=active").catch(() => null);
  return {
    apiVersion: info?.data?.api_version ?? null,
    agents: all.data?.total_affected_items ?? 0,
    activeAgents: active?.data?.total_affected_items ?? null,
  };
}

/** Přihlášený klient Wazuh API (jen GET) – pro další čtecí integrace (SCA, ADR-064). */
export async function wazuhApiClient(p: { url: string; user: string; password: string; verifyTls?: boolean }, fetchImpl: FetchLike = fetch as FetchLike) {
  const base = p.url.replace(/\/+$/, "");
  const tls = p.verifyTls === false ? { rejectUnauthorized: false } : undefined;
  const authRes = await wazuhFetch(fetchImpl, `${base}/security/user/authenticate`, { method: "POST", headers: { Authorization: `Basic ${btoa(`${p.user}:${p.password}`)}` }, tls });
  if (authRes.status === 401) throw new Error("Wazuh odmítl přihlášení – zkontrolujte uživatele a heslo API.");
  if (!authRes.ok) throw new Error(`Wazuh autentizace selhala: HTTP ${authRes.status}`);
  const token: string = ((await authRes.json()) as any).data.token;
  return {
    async get<T = any>(path: string): Promise<{ items: T[]; total: number }> {
      const res = await wazuhFetch(fetchImpl, `${base}${path}`, { headers: { Authorization: `Bearer ${token}` }, tls });
      if (!res.ok) throw new Error(`Wazuh ${path.split("?")[0]}: HTTP ${res.status}`);
      const body = (await res.json()) as any;
      return { items: body.data?.affected_items ?? [], total: body.data?.total_affected_items ?? 0 };
    },
  };
}
