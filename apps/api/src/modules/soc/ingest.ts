import { ATTACK_ID_RE, SEVERITY_LEVEL, SOC_INGEST_MAX_EVENTS, SOC_OPEN_STATUSES, SOC_PRESET_SOURCE, SOC_SEVERITIES, tacticsFor, type SocIngestResult, type SocSeverity, type SocSourcePreset } from "@contix/shared";
import { createHash } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { alertSuggestions, assets, socSources } from "../../db/schema";
import { refreshExposure } from "./exposure";
import { activeSuppressions, correlateAlerts, suppressGroup } from "./service";

/* ============================================================
 * Příjem alertů z dalších nástrojů webhookem (ADR-052): normalizace (obecný JSON, Suricata EVE, Microsoft Defender),
 * seskupení podle zdroje + pravidla + hostitele, potlačení, přiřazení aktiva podle názvu hostitele nebo IP.
 * ============================================================ */

export interface NormEvent {
  ruleId: string;
  title: string;
  description: string;
  level: number;
  host: string | null;
  /** Cílová IP (aktivum). */
  ip: string | null;
  srcip: string | null;
  srcuser: string | null;
  mitreIds: string[];
  at: Date;
  sample: Record<string, unknown>;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 300): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : null);
const get = (o: Obj, path: string): unknown => path.split(".").reduce<unknown>((x, k) => (isObj(x) ? x[k] : undefined), o);
const first = (o: Obj, ...paths: string[]) => {
  for (const p of paths) {
    const v = get(o, p);
    if (v != null && v !== "") return v;
  }
  return undefined;
};
const shortHash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);
const IP4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const ipOf = (v: unknown) => {
  const s = str(v, 45);
  return s && (IP4.test(s) || /^[0-9a-f:]+$/i.test(s)) ? s : null;
};
const date = (v: unknown, now: Date) => {
  const s = str(v, 50);
  const d = s ? new Date(s) : null;
  return d && !Number.isNaN(d.getTime()) && d.getTime() < now.getTime() + 3600_000 ? d : now;
};
const techniques = (v: unknown): string[] =>
  [...new Set((Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,;]+/) : []).map((x) => String(x).trim().toUpperCase()).filter((x) => ATTACK_ID_RE.test(x)))].slice(0, 20);

/** Úroveň 0–15 z textové nebo číselné závažnosti (číslo 1–15 = úroveň jako u Wazuhu). */
export function levelOf(v: unknown, fallback: SocSeverity): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.min(15, Math.round(v)));
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (/^\d+$/.test(s)) return levelOf(Number(s), fallback);
  if ((SOC_SEVERITIES as readonly string[]).includes(s)) return SEVERITY_LEVEL[s as SocSeverity];
  if (s === "informational" || s === "info") return 2;
  if (s === "severe") return SEVERITY_LEVEL.critical;
  return SEVERITY_LEVEL[fallback];
}

const rid = (preset: SocSourcePreset, id: string | null, title: string) => `${preset}:${id ?? shortHash(title.toLowerCase())}`.slice(0, 50);

/** Obecný JSON: title (povinné), severity, host / ip / srcip, mitre, ruleId, timestamp. */
function generic(o: Obj, sev: SocSeverity, now: Date): NormEvent | null {
  const title = str(first(o, "title", "name", "message", "rule.description", "alert"));
  if (!title) return null;
  const desc = str(first(o, "description", "details", "msg"), 2000) ?? title;
  return {
    ruleId: rid("generic", str(first(o, "ruleId", "rule_id", "rule.id", "signature_id", "type"), 40), title),
    title,
    description: desc,
    level: levelOf(first(o, "severity", "level", "priority", "rule.level"), sev),
    host: str(first(o, "host", "hostname", "host.name", "device", "computer"), 255),
    ip: ipOf(first(o, "ip", "dest_ip", "dst_ip", "destination.ip", "host.ip")),
    srcip: ipOf(first(o, "srcip", "src_ip", "source_ip", "source.ip")),
    srcuser: str(first(o, "user", "srcuser", "username", "user.name"), 120),
    mitreIds: techniques(first(o, "mitre", "mitreIds", "techniques", "mitre_technique", "threat.technique.id")),
    at: date(first(o, "timestamp", "@timestamp", "time", "date"), now),
    sample: { eventId: str(first(o, "id", "event_id"), 100), category: str(first(o, "category"), 120) },
  };
}

/** Suricata EVE JSON – jen `event_type: alert`; severity 1 = vysoká, 2 = střední, 3 = nízká. */
function suricata(o: Obj, _sev: SocSeverity, now: Date): NormEvent | null {
  if (o.event_type !== "alert" || !isObj(o.alert)) return null;
  const a = o.alert;
  const title = str(a.signature) ?? `Suricata ${str(a.signature_id) ?? ""}`.trim();
  const s = Number(a.severity);
  const meta = isObj(a.metadata) ? a.metadata : {};
  return {
    ruleId: rid("suricata", str(a.signature_id, 40), title),
    title,
    description: [title, str(a.category), o.proto ? `${o.proto} ${o.src_ip}:${o.src_port ?? ""} → ${o.dest_ip}:${o.dest_port ?? ""}` : null].filter(Boolean).join(" · ").slice(0, 2000),
    level: s === 1 ? SEVERITY_LEVEL.high : s === 2 ? SEVERITY_LEVEL.medium : SEVERITY_LEVEL.low,
    host: str(o.host ?? get(o, "http.hostname"), 255),
    ip: ipOf(o.dest_ip),
    srcip: ipOf(o.src_ip),
    srcuser: null,
    mitreIds: techniques(meta.mitre_technique_id),
    at: date(o.timestamp, now),
    sample: { proto: str(o.proto, 20), destPort: o.dest_port ?? null, category: str(a.category, 120), action: str(a.action, 20), eventId: str(o.flow_id, 40) },
  };
}

/** Microsoft Defender – alert z Defender for Endpoint API i Microsoft Graph (security/alerts_v2). */
function defender(o: Obj, sev: SocSeverity, now: Date): NormEvent | null {
  const title = str(o.title);
  if (!title) return null;
  const ev = Array.isArray(o.evidence) ? (o.evidence as unknown[]).filter(isObj) : [];
  const dev = ev.find((e) => String(e["@odata.type"] ?? "").includes("deviceEvidence")) ?? {};
  const ipEv = ev.find((e) => String(e["@odata.type"] ?? "").includes("ipEvidence"));
  const userEv = ev.find((e) => String(e["@odata.type"] ?? "").includes("userEvidence"));
  const devIps = Array.isArray(dev.ipInterfaces) ? (dev.ipInterfaces as unknown[]) : [];
  return {
    ruleId: rid("defender", str(first(o, "detectorId", "alertPolicyId"), 40) ?? (str(o.category) ? shortHash(`${o.category}|${title}`) : null), title),
    title,
    description: (str(o.description, 2000) ?? title).slice(0, 2000),
    level: levelOf(o.severity, sev),
    host: str(first(o, "computerDnsName", "deviceDnsName") ?? dev.deviceDnsName, 255),
    ip: ipOf(devIps[0] ?? first(o, "machineIp")),
    srcip: ipOf(ipEv?.ipAddress),
    srcuser: str(get(userEv ?? {}, "userAccount.accountName") ?? o.relatedUser, 120),
    mitreIds: techniques(o.mitreTechniques),
    at: date(first(o, "alertCreationTime", "createdDateTime", "firstActivity", "firstActivityDateTime"), now),
    sample: { eventId: str(o.id, 100), category: str(o.category, 120), detectionSource: str(o.detectionSource ?? o.serviceSource, 80), url: str(o.alertWebUrl, 500) },
  };
}

/** Microsoft Sentinel – incident z REST API (SecurityInsights/incidents) nebo z Logic App (`object.properties`). Uzavřené se přeskočí. */
function sentinel(o: Obj, sev: SocSeverity, now: Date): NormEvent | null {
  const root = isObj(o.object) ? o.object : o;
  const p = isObj(root.properties) ? root.properties : root;
  const title = str(p.title);
  if (!title || String(p.status ?? "").toLowerCase() === "closed") return null;
  const add = isObj(p.additionalData) ? p.additionalData : {};
  const rules = Array.isArray(p.relatedAnalyticRuleIds) ? (p.relatedAnalyticRuleIds as unknown[]).map(String) : [];
  const num = str(p.incidentNumber, 20);
  const owner = isObj(p.owner) ? p.owner : {};
  return {
    // každý incident Sentinelu = vlastní alert (stejný incident při změně jen navýší počet)
    ruleId: rid("sentinel", num ? `inc-${num}` : rules[0] ? shortHash(rules[0]) : null, title),
    title,
    description: [str(p.description, 1500), Array.isArray(add.alertProductNames) ? `Produkty: ${(add.alertProductNames as unknown[]).join(", ")}` : null, add.alertsCount != null ? `Alertů v incidentu: ${add.alertsCount}` : null]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 2000) || title,
    level: levelOf(p.severity, sev),
    host: str(first(p, "hostName", "computer") ?? null, 255),
    ip: null,
    srcip: null,
    srcuser: str(owner.userPrincipalName, 120),
    mitreIds: techniques(add.techniques),
    at: date(first(p, "createdTimeUtc", "firstActivityTimeUtc", "lastModifiedTimeUtc"), now),
    sample: { eventId: str(root.name ?? p.incidentNumber, 100), incidentNumber: num, url: str(p.incidentUrl, 500), status: str(p.status, 20), tactics: Array.isArray(add.tactics) ? (add.tactics as unknown[]).map(String).slice(0, 14) : null, modifiedAt: str(p.lastModifiedTimeUtc, 50) },
  };
}

/** Pole dokumentu Elasticu – dokumenty alertů mají klíče s tečkami („kibana.alert.rule.name“) i vnořené objekty. */
const ef = (o: Obj, ...paths: string[]) => {
  for (const p of paths) {
    const v = p in o ? o[p] : get(o, p);
    if (v != null && v !== "") return Array.isArray(v) && v.length && typeof v[0] !== "object" ? v[0] : v;
  }
  return undefined;
};
/** Elastic Security – detekční alert (index .alerts-security.alerts-*, `_source` nebo celý hit). */
function elastic(o: Obj, sev: SocSeverity, now: Date): NormEvent | null {
  const d = isObj(o._source) ? o._source : o;
  const title = str(ef(d, "kibana.alert.rule.name", "signal.rule.name", "rule.name"));
  if (!title) return null;
  const threat = ef(d, "kibana.alert.rule.threat", "signal.rule.threat");
  const tech = (Array.isArray(threat) ? threat : isObj(threat) ? [threat] : []).filter(isObj).flatMap((x) =>
    (Array.isArray(x.technique) ? x.technique : []).filter(isObj).flatMap((t) => [t.id, ...(Array.isArray(t.subtechnique) ? t.subtechnique.filter(isObj).map((s) => s.id) : [])]),
  );
  const risk = Number(ef(d, "kibana.alert.risk_score", "signal.rule.risk_score"));
  const severity = ef(d, "kibana.alert.severity", "signal.rule.severity");
  return {
    ruleId: rid("elastic", str(ef(d, "kibana.alert.rule.rule_id", "kibana.alert.rule.uuid", "signal.rule.id"), 40), title),
    title,
    description: (str(ef(d, "kibana.alert.reason", "signal.reason", "message"), 2000) ?? title).slice(0, 2000),
    level: severity != null ? levelOf(severity, sev) : Number.isFinite(risk) ? levelOf(risk >= 74 ? "critical" : risk >= 48 ? "high" : risk >= 22 ? "medium" : "low", sev) : SEVERITY_LEVEL[sev],
    host: str(ef(d, "host.name", "host.hostname"), 255),
    ip: ipOf(ef(d, "host.ip", "destination.ip")),
    srcip: ipOf(ef(d, "source.ip")),
    srcuser: str(ef(d, "user.name"), 120),
    mitreIds: techniques(tech),
    at: date(ef(d, "kibana.alert.original_time", "@timestamp"), now),
    sample: { eventId: str(ef(d, "kibana.alert.uuid") ?? o._id, 100), riskScore: Number.isFinite(risk) ? risk : null, workflowStatus: str(ef(d, "kibana.alert.workflow_status"), 20), timestamp: str(ef(d, "@timestamp"), 50) },
  };
}

const NORMALIZERS: Record<SocSourcePreset, (o: Obj, sev: SocSeverity, now: Date) => NormEvent | null> = { generic, suricata, defender, sentinel, elastic };

/** Tělo požadavku → seznam událostí: objekt, pole, { events | value | alerts: [...] } nebo NDJSON (eve.json). */
export function parseEvents(text: string): Obj[] {
  const t = text.trim();
  if (!t) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch {
    parsed = t
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      });
  }
  const list = Array.isArray(parsed) ? parsed : isObj(parsed) ? ((["events", "value", "alerts"].map((k) => parsed && (parsed as Obj)[k]).find(Array.isArray) as unknown[] | undefined) ?? [parsed]) : [];
  return list.filter(isObj);
}

export function normalizeEvents(preset: SocSourcePreset, list: Obj[], sev: SocSeverity, now = new Date()): NormEvent[] {
  return list
    .slice(0, SOC_INGEST_MAX_EVENTS)
    .map((o) => NORMALIZERS[preset](o, sev, now))
    .filter((x): x is NormEvent => !!x);
}

type Source = typeof socSources.$inferSelect;

/** Uloží normalizované události jako alerty SOC (seskupení, potlačení, aktivum). Vrací souhrn a ID dotčených alertů. */
export async function ingestEvents(db: Db, src: Source, events: NormEvent[], skipped: number, now = new Date()): Promise<SocIngestResult & { ids: string[] }> {
  const source = SOC_PRESET_SOURCE[src.preset as SocSourcePreset] ?? "webhook";
  // seskupit v rámci požadavku
  const groups = new Map<string, NormEvent & { n: number; first: Date; last: Date }>();
  for (const e of events) {
    // hostitel bez domény (PC-01 = pc-01.firma.local), jinak cílová IP
    const host = e.host ? (IP4.test(e.host) ? e.host : e.host.toLowerCase().split(".")[0]) : null;
    const key = `src:${src.id}:${e.ruleId}:${host ?? e.ip ?? "-"}`.slice(0, 200);
    const g = groups.get(key);
    if (!g) groups.set(key, { ...e, n: 1, first: e.at, last: e.at });
    else {
      g.n++;
      g.level = Math.max(g.level, e.level);
      if (e.at < g.first) g.first = e.at;
      if (e.at > g.last) g.last = e.at;
    }
  }
  // aktiva podle názvu hostitele nebo IP (jeden dotaz)
  const hosts = [...new Set([...groups.values()].flatMap((g) => (g.host ? [g.host.toLowerCase(), g.host.toLowerCase().split(".")[0]!] : [])))];
  const ips = [...new Set([...groups.values()].map((g) => g.ip).filter((x): x is string => !!x))];
  const cand =
    hosts.length || ips.length
      ? await db
          .select({ id: assets.id, name: assets.name, hostname: assets.hostname, fqdn: assets.fqdn, ips: assets.ipAddresses })
          .from(assets)
          .where(
            and(
              eq(assets.companyId, src.companyId),
              or(
                hosts.length ? sql`lower(${assets.hostname}) in (${sql.join(hosts.map((h) => sql`${h}`), sql`, `)})` : undefined,
                hosts.length ? sql`lower(${assets.fqdn}) in (${sql.join(hosts.map((h) => sql`${h}`), sql`, `)})` : undefined,
                hosts.length ? sql`lower(${assets.name}) in (${sql.join(hosts.map((h) => sql`${h}`), sql`, `)})` : undefined,
                ips.length ? sql`${assets.ipAddresses} && ARRAY[${sql.join(ips.map((i) => sql`${i}`), sql`, `)}]::text[]` : undefined,
              ),
            ),
          )
      : [];
  const assetFor = (g: NormEvent) => {
    const h = g.host?.toLowerCase();
    const short = h?.split(".")[0];
    return (
      cand.find((a) => h && [a.hostname, a.fqdn, a.name].some((x) => x && (x.toLowerCase() === h || x.toLowerCase() === short))) ?? cand.find((a) => g.ip && a.ips.includes(g.ip)) ?? null
    );
  };
  const suppressions = await activeSuppressions(db, now);
  let created = 0;
  let updated = 0;
  let suppressed = 0;
  const ids: string[] = [];
  for (const [key, g] of groups) {
    if (suppressions.length && (await suppressGroup(db, suppressions, { companyId: src.companyId, ruleId: g.ruleId, agentId: null, srcip: g.srcip, n: g.n, last: g.last }))) {
      suppressed += g.n;
      continue;
    }
    const [open] = await db
      .select()
      .from(alertSuggestions)
      .where(and(eq(alertSuggestions.groupKey, key), inArray(alertSuggestions.status, [...SOC_OPEN_STATUSES])))
      .limit(1);
    if (open) {
      await db
        .update(alertSuggestions)
        .set({ count: open.count + g.n, lastSeen: g.last > open.lastSeen ? g.last : open.lastSeen, ruleLevel: Math.max(open.ruleLevel, g.level), updatedAt: new Date() })
        .where(eq(alertSuggestions.id, open.id));
      ids.push(open.id);
      updated++;
      continue;
    }
    const asset = assetFor(g);
    const [row] = await db
      .insert(alertSuggestions)
      .values({
        companyId: src.companyId,
        source,
        sourceId: src.id,
        groupKey: key,
        ruleId: g.ruleId,
        ruleLevel: g.level,
        title: g.title,
        description: g.description,
        agentName: g.host,
        assetId: asset?.id ?? null,
        firstSeen: g.first,
        lastSeen: g.last,
        count: g.n,
        mitreIds: g.mitreIds,
        mitreTactics: tacticsFor(g.mitreIds),
        sample: Object.fromEntries(Object.entries({ ...g.sample, timestamp: g.last.toISOString(), srcip: g.srcip, dstip: g.ip, srcuser: g.srcuser, host: g.host }).filter(([, v]) => v != null)),
      })
      .returning({ id: alertSuggestions.id });
    ids.push(row!.id);
    created++;
  }
  await db
    .update(socSources)
    .set({ eventsTotal: sql`${socSources.eventsTotal} + ${events.length}`, alertsCreated: sql`${socSources.alertsCreated} + ${created}`, lastEventAt: now, lastError: null, updatedAt: now })
    .where(eq(socSources.id, src.id));
  if (ids.length) {
    await refreshExposure(db, ids);
    await correlateAlerts(db, now);
  }
  return { accepted: events.length, created, updated, suppressed, skipped, ids };
}
