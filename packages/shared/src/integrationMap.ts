import type { AgentDto, ConcentratorConnectionDto } from "./agentProtocol";
import type { CollectorConnectionDto, JiraConnectionDto, NetboxConnectionDto, WazuhConnectionDto } from "./connections";
import type { HostSummaryDto } from "./hostInventory";
import type { OpsCheck } from "./ops";
import type { ProbeConnectionDto } from "./securityTests";

/* ============================================================
 * Mapa propojení (v1.86, ADR-181): co komunikuje s čím, po zónách a se stavy. Výpočet je čistá funkce nad přehledy
 * konektorů – stejný pro Administraci → Konektory, stránku mapy i dlaždici v Přehledu. Vazby se odvozují jen z ID
 * (agent → koncentrátor, server → připojení), nikdy podle názvu.
 * ============================================================ */

export type MapStatus = "ok" | "warn" | "error" | "off";
export const MAP_STATUSES: MapStatus[] = ["ok", "warn", "error", "off"];

/** Nejnovější vydaná verze agenta – starší je „zastaralá“. */
export const AGENT_LATEST_VERSION = "0.3.0";
/** Agent a koncentrátor se hlásí každých 15 minut. */
export const MAP_HELLO_WARN_MIN = 35;
export const MAP_HELLO_ERROR_MIN = 120;
/** Sběrač běží z cronu dvakrát denně. */
export const MAP_COLLECTOR_WARN_H = 13;
export const MAP_COLLECTOR_ERROR_H = 48;

export type MapNodeKind = "core" | "concentrator" | "agent" | "collector" | "host" | "wazuh" | "netbox" | "jira" | "probe" | "scan" | "identity" | "service";
export type MapGroupKind = "zone" | "collectors" | "monitoring" | "records" | "services";

/** Důvod stavu: kód (překlad `imap.r.<kód>`) a parametry. */
export interface MapReason {
  code: string;
  /** „info“ = jen pro informaci (zabezpečení serveru), stav spojení nemění. */
  level: MapStatus | "info";
  params?: Record<string, string | number>;
}
/** Údaj v panelu detailu: klíč (překlad `imap.f.<klíč>`) a hodnota. */
export interface MapFact {
  key: string;
  value: string;
}
export interface MapLink {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
}
export interface MapNodeDto {
  id: string;
  kind: MapNodeKind;
  group: string | null;
  /** Nadřazený uzel (agent → koncentrátor, server → sběrač). */
  parent: string | null;
  title: string;
  sub: string | null;
  status: MapStatus;
  reasons: MapReason[];
  facts: MapFact[];
  links: { key: string; link: MapLink }[];
  /** Krátký odznak u uzlu (skóre hardeningu, počet agentů). */
  badge: string | null;
}
export interface MapEdgeDto {
  from: string;
  to: string;
  /** Protokol a port (bez překladu) nebo klíč `imap.e.*`. */
  label: string;
  status: MapStatus;
  /** Zpráv / hlášení za posledních 24 h (null = neměří se). */
  msgs24h: number | null;
}
export interface MapGroupDto {
  id: string;
  kind: MapGroupKind;
  side: "left" | "right";
  /** U zóny její název, jinak prázdné (název z překladu `imap.g.<kind>`). */
  title: string;
  counts: Record<MapStatus, number>;
}
export interface MapCoverage {
  servers: number;
  agent: number;
  collector: number;
  wazuh: number;
  /** Server bez jakéhokoli sběru (agent, sběrač, Wazuh). */
  none: number;
  /** Server hlášený agentem i sběračem současně (duplicitní zdroj). */
  duplicate: number;
  noneSample: { id: string; name: string }[];
  /** Servery a řadiče domény z AD (aktivní za 90 dní) a kolik z nich nemá aktivum v CONTIXu (v1.90). */
  adServers?: number;
  adNoAsset?: number;
}
export interface IntegrationMapDto {
  at: string;
  groups: MapGroupDto[];
  nodes: MapNodeDto[];
  edges: MapEdgeDto[];
  totals: Record<MapStatus, number>;
  coverage: MapCoverage | null;
}

export interface MapIdentitySource {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  lastSyncAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  syncHours: number;
}
export type MapHost = HostSummaryDto;
export interface IntegrationMapInput {
  now: Date;
  concentrators: ConcentratorConnectionDto[];
  agents: AgentDto[];
  collectors: CollectorConnectionDto[];
  hosts: MapHost[];
  wazuh: WazuhConnectionDto[];
  netbox: NetboxConnectionDto[];
  jira: JiraConnectionDto[];
  probes: ProbeConnectionDto[];
  scan: { enabled: boolean; nmapFound: boolean; allowedCidrs: string[] } | null;
  identity: MapIdentitySource[];
  /** Vybrané kontroly provozu (`systemStatus`) jako služby, se kterými CONTIX komunikuje. */
  services: OpsCheck[];
  /** Zpráv agenta za 24 h podle ID agenta. */
  agentMsgs24h: Record<string, number>;
  coverage: MapCoverage | null;
}

/* ---------- pomocné ---------- */

const RANK: Record<MapStatus, number> = { off: 0, ok: 1, warn: 2, error: 3 };
/** Horší ze stavů (vypnuto se nepočítá jako problém). */
export const worst = (...s: MapStatus[]): MapStatus => s.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "ok" as MapStatus);
const minutes = (iso: string | null | undefined, now: Date) => (iso ? (now.getTime() - new Date(iso).getTime()) / 60_000 : Infinity);
const statusOf = (reasons: MapReason[], off = false): MapStatus => (off ? "off" : worst(...reasons.flatMap((r) => (r.level === "info" ? [] : [r.level]))));
const since = (iso: string) => iso;

/** Porovnání verzí „0.2.0-dev+20261117“ – jen čísla major.minor.patch (dev < vydaná). */
export function versionLess(a: string, b: string): boolean {
  const parse = (v: string) => {
    const m = /(\d+)\.(\d+)\.(\d+)(-[^+\s]*)?/.exec(v);
    return m ? { n: [Number(m[1]), Number(m[2]), Number(m[3])], pre: !!m[4] } : null;
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i]! < y.n[i]!;
  return x.pre && !y.pre;
}

/** Hostitel a port z adresy (bez URL API – shared běží i mimo prohlížeč a Bun). */
const URL_RE = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^:/?#]+)(?::(\d+))?/i;
const portOf = (url: string, fallback: string) => URL_RE.exec(url.trim())?.[2] ?? fallback;
const hostOf = (url: string) => {
  const m = URL_RE.exec(url.trim());
  return m ? `${m[1]}${m[2] ? `:${m[2]}` : ""}` : url;
};

/** Stav posledního hlášení podle stáří. */
function freshness(iso: string | null | undefined, now: Date, warnMin: number, errorMin: number, reasons: MapReason[]) {
  if (!iso) {
    reasons.push({ code: "never_seen", level: "warn" });
    return;
  }
  const m = minutes(iso, now);
  if (m > errorMin) reasons.push({ code: "silent", level: "error", params: { since: since(iso) } });
  else if (m > warnMin) reasons.push({ code: "stale", level: "warn", params: { since: since(iso) } });
}

const SERVICE_KEYS = ["ai", "vuln_intel", "legislation", "notifications", "converter", "backup", "alerts"] as const;
const SERVICE_LABEL: Record<string, string> = { ai: "AI", vuln_intel: "CISA KEV · EPSS", legislation: "e-Sbírka · EUR-Lex", notifications: "E-mail · Teams", converter: "LibreOffice", backup: "Zálohy", alerts: "Wazuh alerty" };

/* ---------- výpočet mapy ---------- */

export function buildIntegrationMap(i: IntegrationMapInput): IntegrationMapDto {
  const { now } = i;
  const nodes: MapNodeDto[] = [];
  const edges: MapEdgeDto[] = [];
  const groups: MapGroupDto[] = [];
  const hostsById = new Map(i.hosts.map((h) => [h.id, h]));
  const node = (n: Omit<MapNodeDto, "status"> & { status?: MapStatus; off?: boolean }): MapNodeDto => {
    const { off, ...rest } = n;
    const out: MapNodeDto = { ...rest, status: n.status ?? statusOf(n.reasons, off) };
    nodes.push(out);
    return out;
  };

  // servery hlášené agentem i sběračem (stejné aktivum) – duplicitní zdroj
  const agentAssets = new Set(i.agents.filter((a) => a.status === "approved" && a.assetId).map((a) => a.assetId!));
  const collectorIds = new Set(i.collectors.map((c) => c.id));

  /* ----- zóny: koncentrátory a jejich agenti (vazba podle concentratorId) ----- */
  const zoneIds = new Map<string, string>();
  for (const k of i.concentrators) {
    const zkey = (k.zone || "—").trim().toLowerCase();
    let gid = zoneIds.get(zkey);
    if (!gid) {
      gid = `zone-${zoneIds.size + 1}`;
      zoneIds.set(zkey, gid);
      groups.push({ id: gid, kind: "zone", side: "left", title: k.zone || "—", counts: { ok: 0, warn: 0, error: 0, off: 0 } });
    }
    const reasons: MapReason[] = [];
    const seen = k.status?.receivedAt ?? k.lastSeenAt;
    const mine = i.agents.filter((a) => a.concentratorId === k.id);
    if (k.enabled) {
      if (!k.registered) reasons.push({ code: k.codeExpiresAt ? "not_registered_code" : "not_registered", level: "warn" });
      else freshness(seen, now, MAP_HELLO_WARN_MIN, MAP_HELLO_ERROR_MIN, reasons);
      if (k.status?.lastError) reasons.push({ code: "last_error", level: "warn", params: { msg: k.status.lastError } });
      if ((k.status?.queueFiles ?? 0) > 0 && minutes(k.status?.lastForwardAt, now) > 30) reasons.push({ code: "queue", level: "warn", params: { n: k.status!.queueFiles } });
      if (k.status?.caCertExpires && new Date(k.status.caCertExpires).getTime() - now.getTime() < 30 * 86_400_000) reasons.push({ code: "ca_expiring", level: "warn", params: { date: k.status.caCertExpires } });
      if (k.agents.pending) reasons.push({ code: "pending_agents", level: "warn", params: { n: k.agents.pending } });
      if (k.registered && !mine.length) reasons.push({ code: "no_agents", level: "warn" });
      if (k.version && versionLess(k.version, AGENT_LATEST_VERSION)) reasons.push({ code: "outdated", level: "warn", params: { v: k.version, latest: AGENT_LATEST_VERSION } });
    } else reasons.push({ code: "disabled", level: "off" });
    const msgs = mine.reduce((s, a) => s + (i.agentMsgs24h[a.id] ?? 0), 0);
    const kn = node({
      id: `konc-${k.id}`,
      kind: "concentrator",
      group: gid,
      parent: null,
      title: k.name,
      sub: k.hostname,
      reasons,
      off: !k.enabled,
      facts: [
        { key: "zone", value: k.zone },
        { key: "host", value: k.hostname ?? "—" },
        { key: "version", value: k.version ?? "—" },
        { key: "seen", value: seen ?? "" },
        { key: "agents", value: `${k.agents.approved} / ${k.agents.pending} / ${k.agents.blocked}` },
        { key: "queue", value: k.status ? `${k.status.queueFiles} (${Math.round(k.status.queueBytes / 1024)} kB)` : "—" },
        { key: "msgs24h", value: String(msgs) },
        ...(k.status?.caCertExpires ? [{ key: "caExpires", value: k.status.caCertExpires }] : []),
      ],
      links: [{ key: "connectors", link: { to: "/admin/connectors" } }],
      badge: String(k.agents.approved),
    });
    edges.push({ from: kn.id, to: "contix", label: "HTTPS · Ed25519", status: kn.status === "off" ? "off" : kn.status, msgs24h: msgs });

    for (const a of mine) {
      const r: MapReason[] = [];
      const h = a.inventoryId ? hostsById.get(a.inventoryId) : undefined;
      if (a.status === "blocked") r.push({ code: "blocked", level: "off" });
      else if (a.status === "pending") r.push({ code: "pending", level: "warn" });
      else {
        freshness(a.lastSeenAt, now, MAP_HELLO_WARN_MIN, MAP_HELLO_ERROR_MIN, r);
        if (!a.inventoryId) r.push({ code: "not_processed", level: "warn" });
        else if (!a.assetId) r.push({ code: "unpaired", level: "warn" });
        if (a.quarantined) r.push({ code: "quarantine", level: "warn", params: { n: a.quarantined } });
        if (a.version && versionLess(a.version, AGENT_LATEST_VERSION)) r.push({ code: "outdated", level: "warn", params: { v: a.version, latest: AGENT_LATEST_VERSION } });
        // zabezpečení serveru je informace – barva uzlu ukazuje stav spojení
        if (h?.high) r.push({ code: "high_findings", level: "info", params: { n: h.high } });
        if (h?.hardening != null && h.hardening < 65) r.push({ code: "hardening_low", level: "info", params: { score: h.hardening } });
      }
      if (!k.enabled) r.push({ code: "parent_disabled", level: "off" });
      const an = node({
        id: `agent-${a.id}`,
        kind: "agent",
        group: gid,
        parent: kn.id,
        title: a.hostname,
        sub: a.os || null,
        reasons: r,
        status: a.status === "blocked" || !k.enabled ? "off" : undefined,
        facts: [
          { key: "os", value: a.os || "—" },
          { key: "version", value: a.version || "—" },
          { key: "seen", value: a.lastSeenAt ?? "" },
          { key: "msgs24h", value: String(i.agentMsgs24h[a.id] ?? 0) },
          { key: "key", value: a.keyFingerprint },
          ...(h ? [{ key: "findings", value: `${h.high} / ${h.medium} / ${h.low}` }, { key: "hardening", value: h.hardening == null ? "—" : `${h.hardening} %` }, { key: "containers", value: String(h.containers) }] : []),
        ],
        links: [
          ...(a.inventoryId ? [{ key: "host", link: { to: "/discovery/hosts/$hostId", params: { hostId: a.inventoryId } } }] : []),
          ...(a.inventoryId ? [{ key: "hardening", link: { to: "/discovery/hosts/$hostId", params: { hostId: a.inventoryId }, search: { tab: "hardening" } } }] : []),
          ...(a.assetId ? [{ key: "asset", link: { to: "/assets/$assetId", params: { assetId: a.assetId } } }] : []),
        ],
        badge: h?.hardening != null ? `${h.hardening} %` : null,
      });
      edges.push({ from: an.id, to: kn.id, label: "mTLS :8443", status: an.status, msgs24h: i.agentMsgs24h[a.id] ?? 0 });
    }
  }

  /* ----- sběrače a jejich servery (vazba podle connectionId) ----- */
  if (i.collectors.length) {
    groups.push({ id: "collectors", kind: "collectors", side: "left", title: "", counts: { ok: 0, warn: 0, error: 0, off: 0 } });
    for (const s of i.collectors) {
      const reasons: MapReason[] = [];
      const mine = i.hosts.filter((h) => h.connectionId === s.id);
      if (s.enabled) {
        if (!s.lastReportAt) reasons.push({ code: "never_seen", level: "warn" });
        else freshness(s.lastReportAt, now, MAP_COLLECTOR_WARN_H * 60, MAP_COLLECTOR_ERROR_H * 60, reasons);
      } else reasons.push({ code: "disabled", level: "off" });
      const day = mine.filter((h) => minutes(h.collectedAt, now) <= 24 * 60).length;
      const cn = node({
        id: `col-${s.id}`,
        kind: "collector",
        group: "collectors",
        parent: null,
        title: s.name,
        sub: null,
        reasons,
        off: !s.enabled,
        facts: [
          { key: "servers", value: String(mine.length) },
          { key: "seen", value: s.lastReportAt ?? "" },
          { key: "token", value: `${s.tokenPrefix}…` },
        ],
        links: [{ key: "connectors", link: { to: "/admin/connectors" } }],
        badge: String(mine.length),
      });
      edges.push({ from: cn.id, to: "contix", label: "HTTPS · token", status: cn.status, msgs24h: day });
      for (const h of mine) {
        const r: MapReason[] = [];
        freshness(h.collectedAt, now, MAP_COLLECTOR_WARN_H * 60, MAP_COLLECTOR_ERROR_H * 60, r);
        if (!h.assetId) r.push({ code: "unpaired", level: "warn" });
        if (h.high) r.push({ code: "high_findings", level: "info", params: { n: h.high } });
        if (h.assetId && agentAssets.has(h.assetId)) r.push({ code: "duplicate_source", level: "warn" });
        const hn = node({
          id: `host-${h.id}`,
          kind: "host",
          group: "collectors",
          parent: cn.id,
          title: h.hostname,
          sub: h.os,
          reasons: r,
          status: !s.enabled ? "off" : undefined,
          facts: [
            { key: "os", value: h.os ?? "—" },
            { key: "version", value: h.collectorVersion || "—" },
            { key: "seen", value: h.collectedAt },
            { key: "findings", value: `${h.high} / ${h.medium} / ${h.low}` },
          ],
          links: [{ key: "host", link: { to: "/discovery/hosts/$hostId", params: { hostId: h.id } } }, ...(h.assetId ? [{ key: "asset", link: { to: "/assets/$assetId", params: { assetId: h.assetId } } }] : [])],
          badge: h.hardening != null ? `${h.hardening} %` : null,
        });
        edges.push({ from: hn.id, to: cn.id, label: "cron", status: hn.status, msgs24h: null });
      }
    }
  }
  // servery bez platného připojení (vazba vede na neexistující sběrač ani koncentrátor) – neměly by existovat
  const known = new Set([...collectorIds, ...i.concentrators.map((k) => k.id)]);
  const orphans = i.hosts.filter((h) => !known.has(h.connectionId));

  /* ----- bezpečnostní monitoring: Wazuh, sondy, síťový sken ----- */
  if (i.wazuh.length || i.probes.length || i.scan?.enabled) groups.push({ id: "monitoring", kind: "monitoring", side: "right", title: "", counts: { ok: 0, warn: 0, error: 0, off: 0 } });
  for (const w of i.wazuh) {
    const reasons: MapReason[] = [];
    if (!w.enabled) reasons.push({ code: "disabled", level: "off" });
    else {
      if (w.lastSyncStatus === "failed") reasons.push({ code: "sync_failed", level: "error" });
      else if (!w.lastSyncAt) reasons.push({ code: "never_synced", level: "warn" });
      else if (w.autoSyncHours > 0 && minutes(w.lastSyncAt, now) > w.autoSyncHours * 2 * 60) reasons.push({ code: "stale", level: "warn", params: { since: w.lastSyncAt } });
      if (w.alertsEnabled && w.lastAlertResult && /chyb|error|fail/i.test(w.lastAlertResult)) reasons.push({ code: "last_error", level: "warn", params: { msg: w.lastAlertResult } });
    }
    const wn = node({
      id: `wazuh-${w.id}`,
      kind: "wazuh",
      group: "monitoring",
      parent: null,
      title: w.name,
      sub: "Wazuh",
      reasons,
      off: !w.enabled,
      facts: [
        { key: "url", value: hostOf(w.url) },
        ...(w.indexerUrl ? [{ key: "indexer", value: hostOf(w.indexerUrl) }] : []),
        { key: "assets", value: String(w.agents) },
        { key: "sync", value: w.lastSyncAt ?? "" },
        { key: "alerts", value: w.alertsEnabled ? (w.lastAlertSyncAt ?? "—") : "—" },
      ],
      links: [{ key: "connectors", link: { to: "/admin/connectors" } }, { key: "discovery", link: { to: "/discovery" } }],
      badge: String(w.agents),
    });
    edges.push({ from: "contix", to: wn.id, label: [`API :${portOf(w.url, "55000")}`, w.indexerUrl && `indexer :${portOf(w.indexerUrl, "9200")}`].filter(Boolean).join(" · "), status: wn.status, msgs24h: null });
  }
  for (const p of i.probes) {
    const reasons: MapReason[] = [];
    if (!p.enabled) reasons.push({ code: "disabled", level: "off" });
    else freshness(p.lastSeenAt, now, MAP_HELLO_ERROR_MIN, 24 * 60, reasons);
    const pn = node({
      id: `probe-${p.id}`,
      kind: "probe",
      group: "monitoring",
      parent: null,
      title: p.name,
      sub: p.hostname,
      reasons,
      off: !p.enabled,
      facts: [
        { key: "host", value: p.hostname ?? "—" },
        { key: "version", value: p.version ?? "—" },
        { key: "seen", value: p.lastSeenAt ?? "" },
        { key: "tools", value: Object.entries(p.tools).filter(([, v]) => v).map(([k]) => k).join(", ") || "—" },
        { key: "queued", value: String(p.queued) },
      ],
      links: [{ key: "sectests", link: { to: "/security-tests" } }],
      badge: p.queued ? String(p.queued) : null,
    });
    edges.push({ from: pn.id, to: "contix", label: "HTTPS · token", status: pn.status, msgs24h: null });
  }
  if (i.scan?.enabled) {
    const reasons: MapReason[] = i.scan.nmapFound ? [] : [{ code: "nmap_missing", level: "error" }];
    if (!i.scan.allowedCidrs.length) reasons.push({ code: "no_ranges", level: "warn" });
    const sn = node({
      id: "scan",
      kind: "scan",
      group: "monitoring",
      parent: null,
      title: "nmap",
      sub: i.scan.allowedCidrs.slice(0, 2).join(", ") || null,
      reasons,
      facts: [{ key: "cidrs", value: i.scan.allowedCidrs.join(", ") || "—" }],
      links: [{ key: "discovery", link: { to: "/discovery" } }],
      badge: null,
    });
    edges.push({ from: "contix", to: sn.id, label: "nmap", status: sn.status, msgs24h: null });
  }

  /* ----- evidence a úkoly: NetBox, JIRA, AD / Entra ID ----- */
  if (i.netbox.length || i.jira.length || i.identity.length) groups.push({ id: "records", kind: "records", side: "right", title: "", counts: { ok: 0, warn: 0, error: 0, off: 0 } });
  for (const n of i.netbox) {
    const reasons: MapReason[] = !n.enabled ? [{ code: "disabled", level: "off" }] : n.lastSyncStatus === "failed" ? [{ code: "sync_failed", level: "error" }] : !n.lastSyncAt ? [{ code: "never_synced", level: "warn" }] : [];
    const nn = node({ id: `netbox-${n.id}`, kind: "netbox", group: "records", parent: null, title: n.name, sub: "NetBox", reasons, off: !n.enabled, facts: [{ key: "url", value: hostOf(n.url) }, { key: "assets", value: String(n.assets) }, { key: "sync", value: n.lastSyncAt ?? "" }], links: [{ key: "connectors", link: { to: "/admin/connectors" } }], badge: String(n.assets) });
    edges.push({ from: "contix", to: nn.id, label: `API :${portOf(n.url, "443")}`, status: nn.status, msgs24h: null });
  }
  for (const j of i.jira) {
    const reasons: MapReason[] = !j.enabled ? [{ code: "disabled", level: "off" }] : !j.hasToken ? [{ code: "no_token", level: "error" }] : [];
    const jn = node({ id: `jira-${j.id}`, kind: "jira", group: "records", parent: null, title: j.name, sub: `JIRA · ${j.projectKey}`, reasons, off: !j.enabled, facts: [{ key: "url", value: hostOf(j.url) }, { key: "project", value: j.projectKey }, { key: "issues", value: String(j.issues) }], links: [{ key: "connectors", link: { to: "/admin/connectors" } }], badge: String(j.issues) });
    edges.push({ from: "contix", to: jn.id, label: "REST :443", status: jn.status, msgs24h: null });
  }
  for (const s of i.identity) {
    const reasons: MapReason[] = [];
    if (!s.enabled) reasons.push({ code: "disabled", level: "off" });
    else if (s.lastStatus === "error" || s.lastStatus === "failed") reasons.push({ code: "sync_failed", level: "error", params: { msg: s.lastError ?? "" } });
    else if (!s.lastSyncAt) reasons.push({ code: "never_synced", level: "warn" });
    else if (s.syncHours > 0 && minutes(s.lastSyncAt, now) > s.syncHours * 2 * 60) reasons.push({ code: "stale", level: "warn", params: { since: s.lastSyncAt } });
    const idn = node({
      id: `identity-${s.id}`,
      kind: "identity",
      group: "records",
      parent: null,
      title: s.name,
      sub: s.kind === "entra" ? "Entra ID" : "Active Directory",
      reasons,
      off: !s.enabled,
      facts: [{ key: "sync", value: s.lastSyncAt ?? "" }, ...(s.lastError ? [{ key: "error", value: s.lastError }] : [])],
      links: [{ key: "identity", link: { to: "/identity" } }],
      badge: null,
    });
    edges.push({ from: "contix", to: idn.id, label: s.kind === "entra" ? "Graph API :443" : "LDAPS :636", status: idn.status, msgs24h: null });
  }

  /* ----- služby: AI, zdroje hrozeb, legislativa, upozornění, převod dokumentů, zálohy ----- */
  const svc = i.services.filter((c) => (SERVICE_KEYS as readonly string[]).includes(c.key));
  if (svc.length) groups.push({ id: "services", kind: "services", side: "right", title: "", counts: { ok: 0, warn: 0, error: 0, off: 0 } });
  for (const c of svc) {
    const level: MapStatus = c.level === "ok" ? "ok" : c.level === "warning" ? "warn" : c.level === "error" ? "error" : "off";
    const sv = node({
      id: `svc-${c.key}`,
      kind: "service",
      group: "services",
      parent: null,
      title: SERVICE_LABEL[c.key] ?? c.label,
      sub: c.label,
      reasons: level === "ok" ? [] : [{ code: "service", level, params: { msg: c.detail } }],
      status: level,
      facts: [{ key: "detail", value: c.detail }],
      links: [{ key: "ops", link: { to: "/admin/ops" } }],
      badge: null,
    });
    edges.push({ from: c.key === "backup" ? sv.id : "contix", to: c.key === "backup" ? "contix" : sv.id, label: c.key === "backup" ? "pg_dump" : "HTTPS", status: sv.status, msgs24h: null });
  }

  /* ----- jádro: CONTIX ----- */
  const coreReasons: MapReason[] = [];
  if (orphans.length) coreReasons.push({ code: "orphan_hosts", level: "warn", params: { n: orphans.length } });
  if (i.coverage?.none) coreReasons.push({ code: "uncovered", level: "warn", params: { n: i.coverage.none } });
  if (i.coverage?.duplicate) coreReasons.push({ code: "duplicates", level: "warn", params: { n: i.coverage.duplicate } });
  nodes.unshift({
    id: "contix",
    kind: "core",
    group: null,
    parent: null,
    title: "CONTIX",
    sub: null,
    status: statusOf(coreReasons),
    reasons: coreReasons,
    facts: i.coverage
      ? [
          { key: "servers", value: String(i.coverage.servers) },
          { key: "covAgent", value: String(i.coverage.agent) },
          { key: "covCollector", value: String(i.coverage.collector) },
          { key: "covWazuh", value: String(i.coverage.wazuh) },
          { key: "covNone", value: String(i.coverage.none) },
        ]
      : [],
    links: [{ key: "ops", link: { to: "/admin/ops" } }],
    badge: null,
  });

  // souhrny skupin a celku
  const totals: Record<MapStatus, number> = { ok: 0, warn: 0, error: 0, off: 0 };
  for (const n of nodes) {
    if (n.kind === "core") continue;
    totals[n.status]++;
    const g = groups.find((x) => x.id === n.group);
    if (g) g.counts[n.status]++;
  }
  return { at: now.toISOString(), groups, nodes, edges, totals, coverage: i.coverage };
}

/** Uzly s problémem seřazené podle závažnosti (pro „jen problémy“ a dlaždici v Přehledu). */
export function mapProblems(m: IntegrationMapDto): MapNodeDto[] {
  return m.nodes.filter((n) => n.status === "error" || n.status === "warn").sort((a, b) => RANK[b.status] - RANK[a.status] || a.title.localeCompare(b.title));
}
