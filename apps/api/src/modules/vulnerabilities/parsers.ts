import { cvesIn, cweOf, severityFromCvss, severityFromText, type ScanFinding, type Severity, type VulnScanner } from "@contix/shared";
import { XMLParser } from "fast-xml-parser";
import { parseCsv } from "../import/table";

/*
 * Parsery výstupů skenerů (ADR-095). Čisté funkce: text souboru → `ScanFinding[]`, nic nezapisují ani neodesílají.
 * Nový skener = `VULN_SCANNERS` + větev v `detectScanner` a `parseScan` + test.
 */

export const MAX_SCAN_FINDINGS = 50_000;

const arr = <T = any>(v: unknown): T[] => (v == null ? [] : Array.isArray(v) ? (v as T[]) : [v as T]);
const str = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "object") return str((v as Record<string, unknown>)["#text"]);
  return String(v).trim();
};
const opt = (v: unknown, n = 20_000): string | null => {
  const s = stripHtml(str(v));
  return s ? s.slice(0, n) : null;
};
const num = (v: unknown): number | null => {
  const n = Number.parseFloat(str(v));
  return Number.isFinite(n) ? n : null;
};
/** HTML z výstupů (ZAP, Burp) → prostý text. */
export function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
const urlParts = (u: string): { host: string; path: string } => {
  try {
    const x = new URL(u);
    return { host: x.hostname, path: `${x.pathname}${x.search}` };
  } catch {
    return { host: u.replace(/^[a-z]+:\/\//i, "").split(/[/:]/)[0] ?? u, path: "" };
  }
};
const isIp = (s: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) || /^[0-9a-f:]+:[0-9a-f:]*$/i.test(s);

function base(p: Partial<ScanFinding> & Pick<ScanFinding, "ruleId" | "title">): ScanFinding {
  return {
    host: "",
    ip: null,
    cves: [],
    severity: "unknown",
    info: false,
    cvss: null,
    cwe: null,
    packageName: "",
    packageVersion: "",
    fixedVersion: null,
    endpoint: "",
    description: null,
    remediation: null,
    reference: null,
    ...p,
    title: p.title.slice(0, 500) || p.ruleId,
    ruleId: p.ruleId.slice(0, 200),
  };
}

/** Rozpozná formát podle obsahu (případně přípony). */
export function detectScanner(text: string, fileName = ""): VulnScanner | null {
  const head = text.slice(0, 4000).trimStart();
  if (head.startsWith("<")) {
    if (head.includes("NessusClientData_v2")) return "nessus";
    if (/<(HOST_LIST_VM_DETECTION_OUTPUT|SCAN|ASSET_DATA_REPORT)[\s>]/.test(text.slice(0, 20000)) && /QID|<VULN /.test(text.slice(0, 200000))) return "qualys";
    if (/<issues[\s>]/.test(head) && /burpVersion|<issue>/.test(text.slice(0, 20000))) return "burp";
    if (/<report[\s>]/.test(head) || /<get_reports_response/.test(head)) return "openvas";
    return null;
  }
  if (head.startsWith("{") || head.startsWith("[")) {
    let j: any;
    try {
      j = JSON.parse(text);
    } catch {
      return /"template-id"/.test(head) ? "nuclei" : null;
    }
    if (Array.isArray(j)) return j.some((x) => x && typeof x === "object" && "template-id" in x) ? "nuclei" : null;
    if (Array.isArray(j?.runs)) return "sarif";
    if (Array.isArray(j?.Results) || "ArtifactName" in (j ?? {})) return "trivy";
    if (Array.isArray(j?.matches)) return "grype";
    if (Array.isArray(j?.findings) && (j?.project || j?.meta?.application === "Dependency-Track")) return "dependency_track";
    if (j?.site) return "zap";
    if (j?.["template-id"]) return "nuclei";
    return null;
  }
  if (/\.csv$/i.test(fileName) || /[;,\t]/.test(head.split("\n")[0] ?? "")) return "csv";
  return null;
}

const xml = (text: string, arrays: string[]) =>
  new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    parseAttributeValue: false,
    processEntities: true,
    isArray: (name) => arrays.includes(name),
  }).parse(text);

/** Rekurzivně najde všechny hodnoty klíče (zanořené reporty OpenVAS). */
function findAll(o: unknown, key: string, out: any[] = [], depth = 0): any[] {
  if (!o || typeof o !== "object" || depth > 12) return out;
  for (const [k, v] of Object.entries(o)) {
    if (k === key) out.push(...arr(v));
    else findAll(v, key, out, depth + 1);
  }
  return out;
}

function parseNessus(text: string): ScanFinding[] {
  const doc = xml(text, ["ReportHost", "ReportItem", "tag", "cve", "cwe", "Report"]);
  const out: ScanFinding[] = [];
  for (const rep of arr(doc?.NessusClientData_v2?.Report))
    for (const h of arr(rep?.ReportHost)) {
      const tags = new Map(arr(h?.HostProperties?.tag).map((t: any) => [t["@_name"], str(t)]));
      const ip = tags.get("host-ip") || (isIp(str(h["@_name"])) ? str(h["@_name"]) : "");
      const host = tags.get("host-fqdn") || tags.get("hostname") || tags.get("netbios-name") || str(h["@_name"]);
      for (const it of arr(h?.ReportItem)) {
        const sev = Number(str(it["@_severity"]));
        const cvss = num(it.cvss3_base_score) ?? num(it.cvss_base_score);
        const port = str(it["@_port"]);
        out.push(
          base({
            host,
            ip: ip || null,
            ruleId: str(it["@_pluginID"]),
            title: str(it["@_pluginName"]) || str(it.plugin_name),
            cves: cvesIn(arr(it.cve).map(str)),
            severity: sev >= 4 ? "critical" : sev === 3 ? "high" : sev === 2 ? "medium" : sev === 1 ? "low" : "unknown",
            info: sev === 0,
            cvss,
            cwe: cweOf(arr(it.cwe).map(str)[0]),
            endpoint: port && port !== "0" ? `${port}/${str(it["@_protocol"]) || "tcp"}` : "",
            description: opt(it.description ?? it.synopsis),
            remediation: opt(it.solution),
            reference: opt(str(it.see_also).split(/\s+/)[0], 1000),
          }),
        );
      }
    }
  return out;
}

function parseOpenvas(text: string): ScanFinding[] {
  const doc = xml(text, ["result", "ref"]);
  const out: ScanFinding[] = [];
  for (const r of findAll(doc, "result")) {
    if (!r || typeof r !== "object" || !r.nvt) continue;
    const nvt = r.nvt;
    const hostIp = str(r.host);
    const hostname = str(r.host?.hostname);
    const score = num(r.severity) ?? num(nvt.cvss_base);
    const threat = str(r.threat).toLowerCase();
    const tags = new Map(
      str(nvt.tags)
        .split("|")
        .map((x) => [x.split("=")[0]!, x.slice(x.indexOf("=") + 1)] as [string, string]),
    );
    const refs = arr(nvt.refs?.ref);
    const port = str(r.port);
    const sev: Severity = threat === "log" || threat === "debug" ? "unknown" : score != null ? severityFromCvss(score) : severityFromText(threat).severity;
    out.push(
      base({
        host: hostname || hostIp,
        ip: isIp(hostIp) ? hostIp : null,
        ruleId: str(nvt["@_oid"]) || str(nvt.name),
        title: str(nvt.name) || str(r.name),
        cves: cvesIn(refs.filter((x: any) => str(x["@_type"]).toLowerCase() === "cve").map((x: any) => x["@_id"]), str(nvt.cve)),
        severity: sev,
        info: threat === "log" || threat === "debug" || (score ?? 1) === 0,
        cvss: score,
        cwe: cweOf(refs.find((x: any) => str(x["@_type"]).toLowerCase() === "cwe")?.["@_id"]),
        endpoint: port && !/^general/i.test(port) ? port : "",
        description: opt(r.description) ?? opt(tags.get("summary")),
        remediation: opt(nvt.solution) ?? opt(tags.get("solution")),
        reference: opt(refs.find((x: any) => str(x["@_type"]).toLowerCase() === "url")?.["@_id"], 1000),
      }),
    );
  }
  return out;
}

function parseBurp(text: string): ScanFinding[] {
  const doc = xml(text, ["issue"]);
  const out: ScanFinding[] = [];
  for (const it of arr(doc?.issues?.issue)) {
    const hostUrl = str(it.host);
    const { host } = urlParts(hostUrl);
    const s = severityFromText(it.severity);
    const cls = str(it.vulnerabilityClassifications);
    out.push(
      base({
        host,
        ip: str(it.host?.["@_ip"]) || null,
        ruleId: str(it.type) || str(it.name),
        title: str(it.name),
        severity: s.severity,
        info: s.info,
        cwe: cweOf(cls.match(/CWE-\d+/i)?.[0]),
        endpoint: str(it.path).slice(0, 500),
        description: opt([str(it.issueBackground), str(it.issueDetail)].filter(Boolean).join("\n\n")),
        remediation: opt([str(it.remediationBackground), str(it.remediationDetail)].filter(Boolean).join("\n\n")),
        reference: hostUrl ? `${hostUrl}${str(it.path)}`.slice(0, 1000) : null,
      }),
    );
  }
  return out;
}

function parseZap(j: any): ScanFinding[] {
  const out: ScanFinding[] = [];
  for (const site of arr(j?.site)) {
    const name = str(site["@name"]);
    const host = str(site["@host"]) || urlParts(name).host;
    for (const a of arr(site?.alerts)) {
      const risk = Number(str(a.riskcode));
      const inst = arr(a.instances)
        .map((i: any) => str(i.uri))
        .filter(Boolean);
      const desc = [stripHtml(str(a.desc)), inst.length ? `URL:\n${inst.slice(0, 10).join("\n")}${inst.length > 10 ? `\n… (+${inst.length - 10})` : ""}` : ""].filter(Boolean).join("\n\n");
      out.push(
        base({
          host,
          ruleId: str(a.alertRef) || str(a.pluginid),
          title: str(a.alert) || str(a.name),
          severity: risk >= 3 ? "high" : risk === 2 ? "medium" : risk === 1 ? "low" : "unknown",
          info: risk === 0,
          cwe: cweOf(str(a.cweid) === "-1" ? null : a.cweid),
          cves: cvesIn(str(a.reference), str(a.otherinfo)),
          endpoint: "",
          description: desc ? desc.slice(0, 20_000) : null,
          remediation: opt(a.solution),
          reference: opt(stripHtml(str(a.reference)).split(/\s+/)[0], 1000),
        }),
      );
    }
  }
  return out;
}

function parseNuclei(text: string): ScanFinding[] {
  let items: any[];
  const t = text.trim();
  if (t.startsWith("[")) items = JSON.parse(t);
  else
    items = t
      .split(/\r?\n/)
      .filter((l) => l.trim().startsWith("{"))
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  const out: ScanFinding[] = [];
  for (const x of items) {
    const info = x?.info ?? {};
    const cls = info.classification ?? {};
    const hostRaw = str(x.host) || str(x["matched-at"]);
    const { host, path } = urlParts(hostRaw.includes("://") ? hostRaw : `tcp://${hostRaw}`);
    const matched = str(x["matched-at"]);
    const mp = matched.includes("://") ? urlParts(matched).path : matched.replace(/^[^:/]+(:\d+)?/, "");
    const s = severityFromText(info.severity);
    out.push(
      base({
        host,
        ip: str(x.ip) || null,
        ruleId: str(x["template-id"]) + (x["matcher-name"] ? `:${str(x["matcher-name"])}` : ""),
        title: str(info.name) || str(x["template-id"]),
        cves: cvesIn(cls["cve-id"]),
        severity: s.severity === "unknown" && !s.info ? severityFromCvss(num(cls["cvss-score"])) : s.severity,
        info: s.info,
        cvss: num(cls["cvss-score"]),
        cwe: cweOf(arr(cls["cwe-id"])[0]),
        endpoint: (mp || path || "").slice(0, 500),
        description: opt(info.description),
        remediation: opt(info.remediation),
        reference: opt(arr(info.reference)[0], 1000),
      }),
    );
  }
  return out;
}

function parseTrivy(j: any): ScanFinding[] {
  const out: ScanFinding[] = [];
  const host = str(j?.ArtifactName);
  for (const r of arr(j?.Results)) {
    const target = str(r.Target);
    const langPkg = str(r.Class) !== "os-pkgs";
    for (const v of arr(r.Vulnerabilities)) {
      const id = str(v.VulnerabilityID);
      const cvssAll = Object.values((v.CVSS ?? {}) as Record<string, any>);
      const cvss = num(v.CVSS?.nvd?.V3Score) ?? cvssAll.map((c) => num(c?.V3Score)).find((n) => n != null) ?? null;
      const s = severityFromText(v.Severity);
      out.push(
        base({
          host,
          ruleId: id,
          title: str(v.Title) || id,
          cves: cvesIn(id),
          severity: s.severity === "unknown" ? severityFromCvss(cvss) : s.severity,
          info: false,
          cvss,
          cwe: cweOf(arr(v.CweIDs)[0]),
          packageName: str(v.PkgName),
          packageVersion: str(v.InstalledVersion),
          fixedVersion: str(v.FixedVersion) || null,
          endpoint: langPkg ? target.slice(0, 500) : "",
          description: opt(v.Description),
          remediation: str(v.FixedVersion) ? `Aktualizujte ${str(v.PkgName)} na ${str(v.FixedVersion)}.` : null,
          reference: opt(v.PrimaryURL, 1000),
        }),
      );
    }
  }
  return out;
}

function parseGrype(j: any): ScanFinding[] {
  const out: ScanFinding[] = [];
  const host = str(j?.source?.target?.userInput) || str(j?.source?.target);
  for (const m of arr(j?.matches)) {
    const v = m.vulnerability ?? {};
    const a = m.artifact ?? {};
    const id = str(v.id);
    const cvss = arr(v.cvss)
      .map((c: any) => num(c?.metrics?.baseScore))
      .find((n) => n != null) ?? null;
    const fix = arr(v.fix?.versions).map(str).filter(Boolean)[0] ?? null;
    const s = severityFromText(v.severity);
    out.push(
      base({
        host,
        ruleId: id,
        title: `${id} (${str(a.name)})`,
        cves: cvesIn(id, arr(m.relatedVulnerabilities).map((r: any) => r?.id)),
        severity: s.severity === "unknown" ? severityFromCvss(cvss) : s.severity,
        info: false,
        cvss,
        packageName: str(a.name),
        packageVersion: str(a.version),
        fixedVersion: fix,
        endpoint: str(arr(a.locations)[0]?.path).slice(0, 500),
        description: opt(v.description ?? arr(m.relatedVulnerabilities)[0]?.description),
        remediation: fix ? `Aktualizujte ${str(a.name)} na ${fix}.` : null,
        reference: opt(v.dataSource ?? arr(v.urls)[0], 1000),
      }),
    );
  }
  return out;
}

function parseSarif(j: any): ScanFinding[] {
  const by = new Map<string, ScanFinding & { _lines: Set<string> }>();
  for (const run of arr(j?.runs)) {
    const driver = run?.tool?.driver ?? {};
    const rules = arr(driver.rules);
    const ruleById = new Map(rules.map((r: any) => [str(r.id), r]));
    for (const res of arr(run?.results)) {
      const rule = (res.ruleIndex != null ? rules[Number(res.ruleIndex)] : null) ?? ruleById.get(str(res.ruleId)) ?? {};
      const ruleId = str(res.ruleId) || str(rule.id);
      const props = rule.properties ?? {};
      const secSev = num(props["security-severity"]);
      const level = str(res.level) || str(rule.defaultConfiguration?.level) || "warning";
      const s = secSev != null ? { severity: severityFromCvss(secSev), info: false } : severityFromText(level === "none" ? "info" : level);
      const loc = arr(res.locations)[0]?.physicalLocation ?? {};
      const uri = str(loc.artifactLocation?.uri);
      const line = str(loc.region?.startLine);
      const key = `${ruleId}|${uri}`;
      const prev = by.get(key);
      if (prev) {
        if (line) prev._lines.add(line);
        continue;
      }
      const tags = arr(props.tags).map(str);
      const f = base({
        host: "",
        ruleId: `${str(driver.name) || "sarif"}:${ruleId}`,
        title: str(rule.shortDescription?.text) || str(rule.name) || str(res.message?.text).slice(0, 200) || ruleId,
        cves: cvesIn(tags, str(res.message?.text)),
        severity: s.severity,
        info: s.info,
        cvss: secSev,
        cwe: cweOf(tags.find((t) => /cwe/i.test(t))),
        endpoint: uri.slice(0, 500),
        description: opt(str(res.message?.text) || str(rule.fullDescription?.text)),
        remediation: opt(rule.help?.text, 5000),
        reference: opt(rule.helpUri, 1000),
      });
      by.set(key, { ...f, _lines: new Set(line ? [line] : []) });
    }
  }
  return [...by.values()].map(({ _lines, ...f }) => ({
    ...f,
    description: _lines.size ? `${f.description ?? ""}\n\nŘádky: ${[..._lines].sort((a, b) => Number(a) - Number(b)).slice(0, 50).join(", ")}`.trim() : f.description,
  }));
}

/** Qualys: výstup detekcí (HOST_LIST_VM_DETECTION_OUTPUT) nebo zpráva skenu (SCAN / IP / VULNS / CAT / VULN). */
function parseQualys(text: string): ScanFinding[] {
  const doc = xml(text, ["HOST", "DETECTION", "IP", "CAT", "VULN", "CVE_ID", "CVE"]);
  const sev = (n: number): { severity: ScanFinding["severity"]; info: boolean } =>
    n >= 5 ? { severity: "critical", info: false } : n === 4 ? { severity: "high", info: false } : n === 3 ? { severity: "medium", info: false } : n === 2 ? { severity: "low", info: false } : { severity: "unknown", info: true };
  const out: ScanFinding[] = [];
  for (const h of findAll(doc, "HOST")) {
    if (!h || typeof h !== "object" || !h.DETECTION_LIST) continue;
    const ip = str(arr(h.IP)[0]);
    const host = str(h.DNS) || str(h.NETBIOS) || ip;
    for (const d of arr(h.DETECTION_LIST?.DETECTION)) {
      const s = sev(Number(str(d.SEVERITY)));
      const type = str(d.TYPE).toLowerCase();
      const port = str(d.PORT);
      out.push(
        base({
          host,
          ip: ip || null,
          ruleId: `QID-${str(d.QID)}`,
          title: str(d.TITLE) || `Qualys QID ${str(d.QID)}`,
          cves: cvesIn(str(d.CVE_ID_LIST), str(d.RESULTS)),
          severity: s.severity,
          info: s.info || type === "info",
          cvss: num(d.CVSS3_BASE) ?? num(d.CVSS_BASE),
          endpoint: port ? `${port}/${str(d.PROTOCOL).toLowerCase() || "tcp"}` : "",
          description: opt(d.RESULTS),
        }),
      );
    }
  }
  for (const ipNode of findAll(doc, "IP")) {
    if (!ipNode || typeof ipNode !== "object" || !ipNode.VULNS) continue;
    const ip = str(ipNode["@_value"]);
    const host = str(ipNode["@_name"]) || ip;
    for (const cat of arr(ipNode.VULNS?.CAT))
      for (const v of arr(cat?.VULN)) {
        const s = sev(Number(str(v["@_severity"])));
        const port = str(cat["@_port"]);
        out.push(
          base({
            host,
            ip: ip || null,
            ruleId: `QID-${str(v["@_number"])}`,
            title: str(v.TITLE) || `Qualys QID ${str(v["@_number"])}`,
            cves: cvesIn(arr(v.CVE_ID_LIST?.CVE_ID).map((c: any) => str(c.ID ?? c))),
            severity: s.severity,
            info: s.info,
            cvss: num(v.CVSS3_BASE) ?? num(v.CVSS_BASE),
            endpoint: port ? `${port}/${str(cat["@_protocol"]).toLowerCase() || "tcp"}` : "",
            description: opt(v.DIAGNOSIS ?? v.RESULT),
            remediation: opt(v.SOLUTION),
          }),
        );
      }
  }
  return out;
}

/** Dependency-Track: Finding Packaging Format (export nálezů projektu). Potlačené nálezy = informativní (přeskočí se). */
function parseDependencyTrack(j: any): ScanFinding[] {
  const host = [str(j?.project?.name), str(j?.project?.version)].filter(Boolean).join(" ");
  return arr(j?.findings).map((f: any) => {
    const c = f.component ?? {};
    const v = f.vulnerability ?? {};
    const id = str(v.vulnId);
    const s = severityFromText(v.severity);
    const suppressed = f.analysis?.isSuppressed === true || ["FALSE_POSITIVE", "NOT_AFFECTED"].includes(str(f.analysis?.state));
    return base({
      host,
      ruleId: id,
      title: str(v.title) || `${id} (${str(c.name)})`,
      cves: cvesIn(id, arr(v.aliases).map((a: any) => a?.cveId)),
      severity: s.severity === "unknown" ? severityFromCvss(num(v.cvssV3BaseScore)) : s.severity,
      info: suppressed || s.info,
      cvss: num(v.cvssV3BaseScore) ?? num(v.cvssV2BaseScore),
      cwe: cweOf(v.cweId ?? v.cwe?.cweId ?? arr(v.cwes)[0]?.cweId),
      packageName: str(c.name).slice(0, 500),
      packageVersion: str(c.version).slice(0, 255),
      endpoint: str(c.purl).slice(0, 500),
      description: opt(v.description),
      remediation: opt(v.recommendation),
      reference: str(v.source) === "NVD" && /^CVE-/.test(id) ? `https://nvd.nist.gov/vuln/detail/${id}` : null,
    });
  });
}

const CSV_COLS = {
  host: ["host", "hostname", "asset", "target", "fqdn", "server", "aktivum"],
  ip: ["ip", "ip address", "ipaddress", "address", "ip adresa"],
  id: ["vuln_id", "vuln id", "id", "plugin", "plugin id", "pluginid", "rule", "rule id", "qid", "check"],
  cve: ["cve", "cves", "cve id"],
  title: ["title", "name", "vulnerability", "název", "nazev", "finding"],
  severity: ["severity", "risk", "závažnost", "zavaznost"],
  cvss: ["cvss", "cvss score", "cvss3", "cvss v3", "cvss base score"],
  package: ["package", "component", "komponenta", "pkg"],
  version: ["version", "installed version", "verze"],
  fixed: ["fixed version", "fix", "fixed in"],
  endpoint: ["port", "endpoint", "url", "path", "location"],
  description: ["description", "details", "popis", "synopsis"],
  solution: ["solution", "remediation", "náprava", "naprava", "fix description"],
  cwe: ["cwe", "cwe id"],
} satisfies Record<string, string[]>;

function parseGenericCsv(text: string): ScanFinding[] {
  const rows = parseCsv(text.replace(/^﻿/, "")).filter((r) => r.some((c) => c.trim()));
  if (rows.length < 2) return [];
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const col = Object.fromEntries(Object.entries(CSV_COLS).map(([k, names]) => [k, header.findIndex((h) => (names as string[]).includes(h))])) as Record<keyof typeof CSV_COLS, number>;
  if (col.host < 0 && col.ip < 0) throw new Error("CSV musí mít sloupec host nebo ip.");
  if (col.cve < 0 && col.id < 0 && col.title < 0) throw new Error("CSV musí mít sloupec cve, id nebo title.");
  const g = (r: string[], k: keyof typeof CSV_COLS) => (col[k] >= 0 ? (r[col[k]!] ?? "").trim() : "");
  return rows.slice(1).map((r) => {
    const cves = cvesIn(g(r, "cve"));
    const cvss = num(g(r, "cvss"));
    const s = severityFromText(g(r, "severity"));
    const ip = g(r, "ip");
    return base({
      host: g(r, "host") || ip,
      ip: ip || null,
      ruleId: g(r, "id") || cves[0] || g(r, "title"),
      title: g(r, "title") || g(r, "id") || cves[0] || "",
      cves,
      severity: s.severity === "unknown" && !s.info ? severityFromCvss(cvss) : s.severity,
      info: s.info,
      cvss,
      cwe: cweOf(g(r, "cwe")),
      packageName: g(r, "package").slice(0, 500),
      packageVersion: g(r, "version").slice(0, 255),
      fixedVersion: g(r, "fixed") || null,
      endpoint: g(r, "endpoint").slice(0, 500),
      description: opt(g(r, "description")),
      remediation: opt(g(r, "solution")),
    });
  });
}

/** Text souboru → nálezy. Neznámý / poškozený formát = Error se srozumitelnou hláškou. */
export function parseScan(text: string, scanner: VulnScanner): ScanFinding[] {
  let out: ScanFinding[];
  try {
    switch (scanner) {
      case "nessus":
        out = parseNessus(text);
        break;
      case "openvas":
        out = parseOpenvas(text);
        break;
      case "qualys":
        out = parseQualys(text);
        break;
      case "defectdojo":
        throw new Error("DefectDojo se načítá konektorem, ne souborem.");
      case "burp":
        out = parseBurp(text);
        break;
      case "nuclei":
        out = parseNuclei(text);
        break;
      case "csv":
        out = parseGenericCsv(text);
        break;
      default: {
        const j = JSON.parse(text);
        out = scanner === "zap" ? parseZap(j) : scanner === "trivy" ? parseTrivy(j) : scanner === "grype" ? parseGrype(j) : scanner === "dependency_track" ? parseDependencyTrack(j) : parseSarif(j);
      }
    }
  } catch (e) {
    if (e instanceof Error && /^CSV musí/.test(e.message)) throw e;
    throw new Error("Soubor se nepodařilo přečíst – zkontrolujte formát výstupu skeneru.");
  }
  out = out.filter((f) => f.ruleId);
  if (out.length > MAX_SCAN_FINDINGS) throw new Error(`Soubor obsahuje příliš mnoho nálezů (max. ${MAX_SCAN_FINDINGS}).`);
  return out;
}
