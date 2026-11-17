import type { SecTestFinding, SecTestHostFacts, SecTestId, SecTestParseResult, SecTestSeverity } from "@contix/shared";
import { XMLParser } from "fast-xml-parser";

/* ============================================================
 * Parsery výstupů nástrojů (v1.56, ADR-153). Čisté funkce: text → nálezy + skutečnosti (porty, služby).
 * Stejné pro výstup ze sondy i pro ruční import. Nový test = SECURITY_TESTS + větev v `parseSecTest` + test.
 * ============================================================ */

const arr = <T = any>(v: unknown): T[] => (v == null ? [] : Array.isArray(v) ? (v as T[]) : [v as T]);
const s = (v: unknown) => (v == null ? "" : String(v).trim());
const clip = (v: string, n = 2000) => (v.length > n ? `${v.slice(0, n)}…` : v);
// eslint-disable-next-line no-control-regex
const stripAnsi = (t: string) => t.replace(/\u001b\[[0-9;]*m/g, "");

const empty = (): SecTestParseResult => ({ findings: [], facts: [], tested: [], warnings: [] });

/* ---------- nmap XML ---------- */

/** Rizikové služby dostupné ze sítě (port → kód, závažnost, popis). */
const RISKY_PORTS: Record<number, { code: string; severity: SecTestSeverity; title: string; detail: string }> = {
  21: { code: "port.ftp", severity: "medium", title: "FTP dostupné ze sítě", detail: "FTP přenáší přihlašovací údaje i data nešifrovaně. Nahraďte SFTP / FTPS, nebo přístup omezte firewallem." },
  23: { code: "port.telnet", severity: "high", title: "Telnet dostupný ze sítě", detail: "Telnet přenáší hesla v otevřené podobě. Vypněte ho a používejte SSH." },
  69: { code: "port.tftp", severity: "medium", title: "TFTP dostupné ze sítě", detail: "TFTP nemá žádné ověření. Povolte ho jen pro nutné zařízení a segment." },
  111: { code: "port.rpcbind", severity: "low", title: "RPC portmapper dostupný ze sítě", detail: "Prozrazuje služby RPC (NFS). Pokud NFS nepoužíváte, službu vypněte nebo omezte firewallem." },
  135: { code: "port.msrpc", severity: "low", title: "MS RPC dostupné ze sítě", detail: "Omezte na správcovské segmenty." },
  139: { code: "port.netbios", severity: "low", title: "NetBIOS dostupný ze sítě", detail: "Zastaralé rozhraní; omezte na nutné segmenty, zvažte vypnutí NetBIOS over TCP/IP." },
  445: { code: "port.smb", severity: "low", title: "SMB dostupné ze sítě", detail: "Zkontrolujte podepisování SMB a SMBv1 (test Windows → SMB) a omezte dostupnost na nutné segmenty." },
  873: { code: "port.rsync", severity: "medium", title: "rsync dostupný ze sítě", detail: "rsync démon bývá bez ověření. Omezte firewallem nebo používejte rsync přes SSH." },
  1433: { code: "port.mssql", severity: "medium", title: "MS SQL dostupný ze sítě", detail: "Databáze má být dostupná jen aplikačním serverům. Omezte firewallem." },
  1521: { code: "port.oracle", severity: "medium", title: "Oracle DB dostupná ze sítě", detail: "Databáze má být dostupná jen aplikačním serverům. Omezte firewallem." },
  2049: { code: "port.nfs", severity: "medium", title: "NFS dostupné ze sítě", detail: "Zkontrolujte exporty (/etc/exports) a omezte je na konkrétní klienty." },
  2375: { code: "port.docker", severity: "critical", title: "Docker API bez TLS dostupné ze sítě", detail: "Kdo se připojí, má root na serveru. Vypněte tcp://0.0.0.0:2375, používejte socket nebo TLS (2376) s certifikáty." },
  3306: { code: "port.mysql", severity: "medium", title: "MySQL / MariaDB dostupná ze sítě", detail: "Databáze má být dostupná jen aplikačním serverům (bind-address, firewall)." },
  3389: { code: "port.rdp", severity: "medium", title: "RDP dostupné ze sítě", detail: "Vyžadujte NLA, MFA a přístup jen přes VPN / jump server; omezte firewallem." },
  5432: { code: "port.postgres", severity: "medium", title: "PostgreSQL dostupná ze sítě", detail: "Omezte listen_addresses a pg_hba.conf na aplikační servery, doplňte firewall." },
  5900: { code: "port.vnc", severity: "high", title: "VNC dostupné ze sítě", detail: "VNC mívá slabé ověření a nešifrovaný provoz. Přístup jen přes VPN / SSH tunel." },
  5985: { code: "port.winrm", severity: "medium", title: "WinRM přes HTTP dostupné ze sítě", detail: "Omezte na správcovské stanice; preferujte HTTPS (5986)." },
  6379: { code: "port.redis", severity: "high", title: "Redis dostupný ze sítě", detail: "Redis bez hesla umožní zápis souborů a převzetí serveru. Nastavte bind 127.0.0.1 / requirepass a firewall." },
  9200: { code: "port.elasticsearch", severity: "high", title: "Elasticsearch dostupný ze sítě", detail: "Bez zabezpečení vydá všechna data. Zapněte xpack.security a omezte firewallem." },
  10250: { code: "port.kubelet", severity: "high", title: "Kubelet API dostupné ze sítě", detail: "Ověřte, že je vypnuté anonymní ověření (anonymous-auth=false) a omezte přístup." },
  11211: { code: "port.memcached", severity: "high", title: "Memcached dostupný ze sítě", detail: "Bez ověření; zneužitelný k DDoS. Bind 127.0.0.1 a firewall." },
  27017: { code: "port.mongodb", severity: "high", title: "MongoDB dostupná ze sítě", detail: "Zapněte ověření (security.authorization) a omezte bindIp a firewall." },
};

/** Rizikové UDP služby (v1.60). */
const RISKY_UDP: Record<number, { code: string; severity: SecTestSeverity; title: string; detail: string }> = {
  69: { code: "udp.tftp", severity: "medium", title: "TFTP dostupné ze sítě", detail: "TFTP nemá ověření – kdokoli může stahovat (a často i nahrávat) soubory, typicky konfigurace zařízení. Omezte na správcovský segment." },
  161: { code: "udp.snmp", severity: "medium", title: "SNMP dostupné ze sítě", detail: "Ověřte komunity (test SNMP s výchozí komunitou), preferujte SNMPv3 a omezte přístup na monitorovací server." },
  623: { code: "udp.ipmi", severity: "high", title: "IPMI / BMC dostupné ze sítě", detail: "Správa serveru (iLO, iDRAC, IPMI) má být jen ve vyhrazené správcovské síti – IPMI 2.0 umožňuje získat hash hesla." },
  1900: { code: "udp.ssdp", severity: "low", title: "SSDP (UPnP) dostupné ze sítě", detail: "UPnP na serveru není potřeba a bývá zneužito k zesílení DDoS. Vypněte službu." },
  11211: { code: "udp.memcached", severity: "high", title: "Memcached přes UDP", detail: "Zneužitelné k masivnímu zesílení DDoS. Vypněte UDP (-U 0) a omezte přístup." },
  137: { code: "udp.netbios", severity: "low", title: "NetBIOS jmenná služba dostupná", detail: "Prozrazuje jména a domény; vypněte NetBIOS over TCP/IP, pokud ho nepotřebujete." },
  5353: { code: "udp.mdns", severity: "low", title: "mDNS dostupné ze sítě", detail: "Na serverech není potřeba; prozrazuje služby a názvy." },
};

const nmapXml = (text: string) =>
  new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false, htmlEntities: true, isArray: (n) => ["host", "port", "address", "hostname", "script", "elem", "table"].includes(n) }).parse(text);

function nmapHosts(text: string) {
  const doc = nmapXml(text);
  const out: { ip: string; hostname: string | null; ports: { port: number; proto: string; state: string; service: string; product: string; version: string; scripts: { id: string; output: string }[] }[]; hostScripts: { id: string; output: string }[] }[] = [];
  for (const h of arr<any>(doc?.nmaprun?.host)) {
    const ip = arr<any>(h.address).find((a) => a["@_addrtype"] === "ipv4" || a["@_addrtype"] === "ipv6")?.["@_addr"] ?? "";
    const hostname = arr<any>(h.hostnames?.hostname)[0]?.["@_name"] ?? null;
    const ports = arr<any>(h.ports?.port).map((p) => ({
      port: Number(p["@_portid"]),
      proto: s(p["@_protocol"]) || "tcp",
      state: s(p.state?.["@_state"]),
      service: s(p.service?.["@_name"]),
      product: s(p.service?.["@_product"]),
      version: [s(p.service?.["@_version"]), s(p.service?.["@_extrainfo"])].filter(Boolean).join(" "),
      scripts: arr<any>(p.script).map((x) => ({ id: s(x["@_id"]), output: s(x["@_output"]) })),
    }));
    const hostScripts = arr<any>(h.hostscript?.script).map((x) => ({ id: s(x["@_id"]), output: s(x["@_output"]) }));
    if (ip) out.push({ ip, hostname, ports, hostScripts });
  }
  return out;
}

function parseNmapPorts(text: string, testId: SecTestId): SecTestParseResult {
  const r = empty();
  for (const h of nmapHosts(text)) {
    r.tested.push(h.ip);
    const open = h.ports.filter((p) => p.state === "open");
    r.facts.push({ host: h.ip, hostname: h.hostname, ports: open.map((p) => ({ port: p.port, proto: p.proto, service: p.service, product: p.product, version: p.version })) });
    for (const p of open) {
      const risk = RISKY_PORTS[p.port];
      if (risk && p.proto === "tcp") r.findings.push({ ...risk, host: h.ip, port: p.port, evidence: clip(`${p.proto}/${p.port} open ${p.service} ${p.product} ${p.version}`.trim()) });
      const ur = RISKY_UDP[p.port];
      if (ur && p.proto === "udp") r.findings.push({ ...ur, host: h.ip, port: p.port, evidence: clip(`udp/${p.port} open ${p.service}`) });
      if (testId === "net.services" && /telnet/i.test(p.service) && !risk) r.findings.push({ ...RISKY_PORTS[23]!, host: h.ip, port: p.port, evidence: `${p.port} ${p.service}` });
    }
  }
  if (!r.tested.length) r.warnings.push("Výstup nmap neobsahuje žádného hostitele (je to XML z -oX?).");
  return r;
}

function parseNmapSmb(text: string): SecTestParseResult {
  const r = empty();
  for (const h of nmapHosts(text)) {
    r.tested.push(h.ip);
    const smb = h.ports.find((p) => p.port === 445);
    if (!smb || smb.state !== "open") continue;
    const scripts = [...h.hostScripts, ...smb.scripts];
    const sec = scripts.filter((x) => /smb2?-security-mode/.test(x.id)).map((x) => x.output).join("\n");
    if (/signing enabled but not required|message_signing:\s*disabled|not required/i.test(sec))
      r.findings.push({ code: "smb.signing_not_required", severity: "medium", title: "SMB nevyžaduje podepisování", detail: "Bez povinného podepisování je možný útok NTLM relay. Nastavte GPO „Microsoft network server: Digitally sign communications (always)“ = Enabled.", host: h.ip, port: 445, evidence: clip(sec) });
    const proto = scripts.find((x) => x.id === "smb-protocols")?.output ?? "";
    if (/SMBv1|NT LM 0\.12/i.test(proto)) r.findings.push({ code: "smb.v1", severity: "high", title: "Server povoluje SMBv1", detail: "SMBv1 je zastaralý a zneužívaný (EternalBlue, WannaCry). Vypněte ho: Set-SmbServerConfiguration -EnableSMB1Protocol $false.", host: h.ip, port: 445, evidence: clip(proto) });
  }
  return r;
}

/* ---------- výstupy skriptů nmap (v1.60): FTP, SMTP, databáze, SNMP, NFS, VNC, RDP ---------- */

type ScriptRule = (o: string, host: string, port: number) => SecTestFinding | SecTestFinding[] | null;
const f = (code: string, severity: SecTestSeverity, title: string, detail: string, host: string, port: number, evidence: string): SecTestFinding => ({ code, severity, title, detail, host, port, evidence: clip(evidence) });
const SCRIPT_RULES: Record<string, ScriptRule> = {
  "ftp-anon": (o, h, p) => (/Anonymous FTP login allowed/i.test(o) ? f("ftp.anonymous", /writeable|WRITE/i.test(o) ? "critical" : "high", "FTP povoluje anonymní přihlášení", "Kdokoli se přihlásí jako „anonymous“ a čte (případně zapisuje) soubory. Vypněte anonymní přístup (vsftpd: anonymous_enable=NO).", h, p, o) : null),
  "smtp-open-relay": (o, h, p) => (/Server is an open relay/i.test(o) ? f("smtp.open_relay", "critical", "Poštovní server je otevřený relay", "Server předá poštu komukoli – zneužití k rozesílání spamu a phishingu z vaší domény. Povolte relay jen ověřeným uživatelům a vlastním sítím.", h, p, o) : null),
  "smtp-commands": (o, h, p) => (o && !/STARTTLS/i.test(o) && p !== 465 ? f("smtp.no_starttls", "medium", "Poštovní server nenabízí STARTTLS", "Pošta a přihlašovací údaje jdou nešifrovaně. Zapněte STARTTLS s platným certifikátem.", h, p, o) : null),
  "mysql-empty-password": (o, h, p) => (/account has empty password|empty password/i.test(o) ? f("db.mysql_empty_password", "critical", "MySQL / MariaDB: účet s prázdným heslem", "Do databáze se lze přihlásit bez hesla. Nastavte heslo (ALTER USER) a omezte přístup na aplikační servery.", h, p, o) : null),
  "ms-sql-empty-password": (o, h, p) => (/Login Success/i.test(o) ? f("db.mssql_empty_password", "critical", "MS SQL: účet s prázdným heslem", "Účet (typicky sa) se přihlásí bez hesla. Nastavte silné heslo nebo účet zakažte a omezte přístup.", h, p, o) : null),
  "mongodb-info": (o, h, p) => (o && !/auth|Unauthorized|requires authentication|command .* requires/i.test(o) && /version|databases|buildInfo/i.test(o) ? f("db.mongodb_noauth", "critical", "MongoDB bez ověření", "Databáze vydá data komukoli. Zapněte security.authorization: enabled a omezte bindIp.", h, p, o) : null),
  "redis-info": (o, h, p) => (o && /Version|Operating System|Used CPU/i.test(o) && !/NOAUTH|Authentication required/i.test(o) ? f("db.redis_noauth", "critical", "Redis bez hesla", "Bez hesla lze číst data a zapisovat soubory (převzetí serveru). Nastavte requirepass / ACL a bind 127.0.0.1.", h, p, o) : null),
  "http-title": (o, h, p) => (p === 9200 && /cluster_name|You Know, for Search|elasticsearch/i.test(o) ? f("db.elastic_noauth", "high", "Elasticsearch bez ověření", "Index je čitelný bez přihlášení. Zapněte xpack.security a omezte přístup.", h, p, o) : null),
  "snmp-sysdescr": (o, h, p) => (o.trim() ? f("snmp.public", "high", "SNMP odpovídá na výchozí komunitu „public“", "Zařízení vydá popis systému a další údaje komukoli. Změňte komunitu, přejděte na SNMPv3 a omezte přístup na monitorovací server.", h, p, o) : null),
  "nfs-showmount": (o, h, p) => {
    const lines = o.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("/"));
    if (!lines.length) return null;
    const world = lines.some((l) => /\s\*$|\s\*\s|everyone/i.test(l));
    return f(world ? "nfs.world_export" : "nfs.exports", world ? "high" : "medium", world ? "NFS export pro všechny (*)" : "NFS exporty viditelné ze sítě", "Exporty omezte na konkrétní klienty (/etc/exports) a používejte root_squash; NFS nemá být dostupné z běžné sítě.", h, p, lines.join("\n"));
  },
  "vnc-info": (o, h, p) => (/None \(1\)|Security types:[\s\S]*None/i.test(o) ? f("vnc.noauth", "critical", "VNC bez hesla", "Vzdálená plocha je dostupná bez ověření. Nastavte heslo, přístup jen přes VPN / SSH tunel.", h, p, o) : null),
  "rdp-enum-encryption": (o, h, p) => {
    const nla = /CredSSP[^\n]*SUCCESS|NLA[^\n]*SUCCESS/i.test(o);
    const native = /Native RDP[^\n]*SUCCESS|RDP Protocol[^\n]*\n[^\n]*Native RDP/i.test(o) || /RDP Encryption level: (Low|Client Compatible)/i.test(o);
    const out: SecTestFinding[] = [];
    if (native && !/SSL[^\n]*SUCCESS/i.test(o) && !nla) out.push(f("rdp.no_nla", "medium", "RDP nevyžaduje ověření na úrovni sítě (NLA)", "Zapněte „Vyžadovat ověření na úrovni sítě“ (GPO: Require user authentication for remote connections by using NLA).", h, p, o));
    else if (native) out.push(f("rdp.native_allowed", "low", "RDP povoluje i starší zabezpečení (Native RDP)", "Vynuťte NLA a TLS (Security Layer = SSL), vypněte nativní šifrování RDP.", h, p, o));
    return out.length ? out : null;
  },
};

function parseNmapScripts(text: string): SecTestParseResult {
  const r = empty();
  for (const h of nmapHosts(text)) {
    r.tested.push(h.ip);
    for (const p of h.ports) {
      if (p.state !== "open" && p.state !== "open|filtered") continue;
      for (const sc of p.scripts) {
        const rule = SCRIPT_RULES[sc.id];
        const out = rule?.(sc.output, h.ip, p.port);
        if (out) r.findings.push(...(Array.isArray(out) ? out : [out]));
      }
    }
    for (const sc of h.hostScripts) {
      const out = SCRIPT_RULES[sc.id]?.(sc.output, h.ip, 0);
      if (out) r.findings.push(...(Array.isArray(out) ? out : [out]).map((x) => ({ ...x, port: x.port || null })));
    }
  }
  if (!r.tested.length) r.warnings.push("Výstup nmap neobsahuje žádného hostitele (je to XML z -oX?).");
  return r;
}

/* ---------- citlivé cesty na webu (v1.60, výstup sondy) ---------- */

export interface PathsProbeOutput {
  url: string;
  checks: { path: string; status: number; size: number; snippet: string }[];
  error?: string;
}

/** Cesta → co musí odpověď obsahovat, aby to nebyla jen obecná stránka (soft 404). */
export const SENSITIVE_PATHS: { path: string; code: string; severity: SecTestSeverity; title: string; must: RegExp; detail: string }[] = [
  { path: "/.git/HEAD", code: "git", severity: "high", title: "Zveřejněný repozitář .git", must: /^ref: refs\//m, detail: "Z adresáře .git lze stáhnout zdrojový kód včetně hesel v historii. Zakažte přístup k /.git na webovém serveru." },
  { path: "/.env", code: "env", severity: "critical", title: "Zveřejněný soubor .env", must: /^[A-Z][A-Z0-9_]+=.+/m, detail: "Soubor .env obvykle obsahuje hesla k databázi a API klíče. Odstraňte ho z webového kořene a klíče vyměňte." },
  { path: "/.svn/entries", code: "svn", severity: "high", title: "Zveřejněný repozitář .svn", must: /^\d+\s*$|dir/m, detail: "Zakažte přístup k /.svn." },
  { path: "/.DS_Store", code: "ds_store", severity: "low", title: "Soubor .DS_Store", must: /Bud1/, detail: "Prozrazuje strukturu adresářů. Odstraňte ho." },
  { path: "/server-status", code: "server_status", severity: "medium", title: "Apache server-status veřejně", must: /Apache Server Status|Server Version/i, detail: "Prozrazuje požadavky, klienty a verzi. Povolte jen z localhostu." },
  { path: "/phpinfo.php", code: "phpinfo", severity: "medium", title: "phpinfo() veřejně", must: /PHP Version|phpinfo\(\)/i, detail: "Prozrazuje konfiguraci a cesty serveru. Soubor odstraňte." },
  { path: "/info.php", code: "phpinfo2", severity: "medium", title: "phpinfo() veřejně (info.php)", must: /PHP Version|phpinfo\(\)/i, detail: "Soubor odstraňte." },
  { path: "/actuator/env", code: "actuator_env", severity: "critical", title: "Spring Boot Actuator /env veřejně", must: /propertySources|activeProfiles/, detail: "Vydá konfiguraci aplikace včetně tajemství. Omezte management endpointy (management.endpoints.web.exposure)." },
  { path: "/actuator/heapdump", code: "actuator_heap", severity: "critical", title: "Spring Boot Actuator /heapdump veřejně", must: /^JAVA PROFILE|HPROF/, detail: "Výpis paměti obsahuje hesla a relace. Endpoint zakažte." },
  { path: "/backup.zip", code: "backup_zip", severity: "high", title: "Záloha backup.zip na webu", must: /^PK/, detail: "Záloha je ke stažení. Odstraňte ji z webového kořene." },
  { path: "/backup.sql", code: "backup_sql", severity: "critical", title: "Výpis databáze backup.sql na webu", must: /CREATE TABLE|INSERT INTO/i, detail: "Databáze je ke stažení. Odstraňte soubor a změňte hesla." },
  { path: "/wp-config.php.bak", code: "wp_config_bak", severity: "critical", title: "Záloha wp-config.php", must: /DB_PASSWORD/, detail: "Obsahuje heslo k databázi WordPressu. Odstraňte a heslo změňte." },
  { path: "/config.php.bak", code: "config_bak", severity: "high", title: "Záloha config.php", must: /<\?php|password/i, detail: "Záloha konfigurace je čitelná jako text. Odstraňte ji." },
  { path: "/.htpasswd", code: "htpasswd", severity: "high", title: "Soubor .htpasswd veřejně", must: /^[^:\s]+:\$?[\w./$]+/m, detail: "Hashe hesel jsou ke stažení. Zakažte přístup k souborům .ht*." },
  { path: "/phpmyadmin/", code: "phpmyadmin", severity: "medium", title: "phpMyAdmin dostupný", must: /phpMyAdmin/i, detail: "Správu databáze zpřístupněte jen ze správcovské sítě / VPN." },
  { path: "/adminer.php", code: "adminer", severity: "medium", title: "Adminer dostupný", must: /Adminer/i, detail: "Správu databáze zpřístupněte jen ze správcovské sítě / VPN." },
  { path: "/.well-known/security.txt", code: "security_txt_missing", severity: "info", title: "security.txt", must: /Contact:/i, detail: "" },
  { path: "/crossdomain.xml", code: "crossdomain", severity: "low", title: "Povolující crossdomain.xml", must: /allow-access-from domain="\*"/, detail: "Povoluje přístup z libovolné domény (Flash / Silverlight). Soubor odstraňte nebo omezte." },
  { path: "/elmah.axd", code: "elmah", severity: "high", title: "ELMAH log chyb veřejně", must: /Error Log for/i, detail: "Log chyb ASP.NET prozrazuje relace a údaje. Omezte přístup." },
  { path: "/trace.axd", code: "trace_axd", severity: "high", title: "ASP.NET trace.axd veřejně", must: /Application Trace/i, detail: "Vypněte trasování (trace enabled=false)." },
  { path: "/WEB-INF/web.xml", code: "webinf", severity: "high", title: "Čitelný WEB-INF/web.xml", must: /<web-app/i, detail: "Konfigurace Java aplikace je čitelná. Opravte konfiguraci serveru." },
];

function parsePaths(text: string): SecTestParseResult {
  const r = empty();
  let list: PathsProbeOutput[];
  try {
    const j = JSON.parse(text);
    list = Array.isArray(j) ? j : [j];
  } catch {
    r.warnings.push("Výstup kontroly cest není JSON.");
    return r;
  }
  for (const o of list) {
    let u: URL;
    try {
      u = new URL(o.url);
    } catch {
      continue;
    }
    const host = u.hostname;
    const port = Number(u.port) || (u.protocol === "https:" ? 443 : 80);
    r.tested.push(host);
    if (o.error) {
      r.warnings.push(`${o.url}: ${o.error}`);
      continue;
    }
    let securityTxt = false;
    for (const c of o.checks ?? []) {
      const def = SENSITIVE_PATHS.find((x) => x.path === c.path);
      if (!def) continue;
      const hit = c.status === 200 && def.must.test(c.snippet ?? "");
      if (def.code === "security_txt_missing") {
        securityTxt = hit;
        continue;
      }
      if (hit) r.findings.push({ code: `path.${def.code}`, severity: def.severity, title: def.title, detail: def.detail, host, port, evidence: clip(`GET ${u.origin}${c.path} → ${c.status}, ${c.size} B: ${(c.snippet ?? "").slice(0, 200)}`) });
    }
    if (!securityTxt && u.protocol === "https:") r.findings.push({ code: "path.security_txt_missing", severity: "low", title: "Chybí /.well-known/security.txt", detail: "Kontakt pro hlášení zranitelností (RFC 9116) – doporučeno i požadavkem CRA na koordinované zveřejňování.", host, port, evidence: `${u.origin}/.well-known/security.txt` });
  }
  return r;
}

/* ---------- přenos DNS zóny (v1.60, text dig) ---------- */

function parseAxfr(text: string, target: string): SecTestParseResult {
  const r = empty();
  const zone = target.replace(/\.$/, "");
  if (!zone) {
    r.warnings.push("Chybí název domény – zadejte ho při importu.");
    return r;
  }
  r.tested.push(zone);
  // výstup sondy: oddíly „;; NS <server>“ + výstup dig axfr
  const blocks = /^;; NS /m.test(text) ? text.split(/^;; NS /m).filter((b) => b.trim()).map((b) => ({ ns: b.split("\n")[0]!.trim() || "?", body: b })) : [{ ns: "?", body: text }];
  for (const { ns, body } of blocks) {
    const records = body.split("\n").filter((l) => /^\S+\s+\d+\s+IN\s+[A-Z]+\s+/.test(l));
    if (!/Transfer failed|communications error|connection refused/i.test(body) && (/XFR size/i.test(body) || records.length > 2) && records.some((l) => /\sSOA\s/.test(l)))
      r.findings.push({ code: `dns.axfr.${ns}`, severity: "high", title: `Jmenný server ${ns} povoluje přenos zóny`, detail: "Kdokoli stáhne kompletní obsah zóny (všechny názvy a adresy). Povolte AXFR jen sekundárním serverům (allow-transfer).", host: zone, port: 53, evidence: clip(`${records.length} záznamů, např.:\n${records.slice(0, 8).join("\n")}`) });
  }
  return r;
}

/* ---------- testssl.sh JSON ---------- */

const TESTSSL_SEV: Record<string, SecTestSeverity | null> = { CRITICAL: "critical", HIGH: "high", MEDIUM: "medium", LOW: "low", WARN: null, INFO: null, OK: null, DEBUG: null };

function parseTestssl(text: string): SecTestParseResult {
  const r = empty();
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    r.warnings.push("Výstup testssl není JSON (--jsonfile).");
    return r;
  }
  const items = Array.isArray(j) ? j : arr<any>(j?.scanResult).flatMap((x: any) => Object.values(x).filter(Array.isArray).flat());
  const hosts = new Set<string>();
  for (const it of items) {
    const ipField = s(it.ip);
    const host = (ipField.split("/")[0] || ipField).trim();
    if (host) hosts.add(host);
    const sev = TESTSSL_SEV[s(it.severity).toUpperCase()];
    if (!sev) continue;
    const id = s(it.id);
    const finding = s(it.finding);
    const cve = s(it.cve);
    r.findings.push({ code: `tls.${id}`, severity: sev, title: tlsTitle(id, finding), detail: [finding, cve && `CVE: ${cve}`, s(it.cwe) && `CWE: ${s(it.cwe)}`].filter(Boolean).join(" · "), host, port: Number(it.port) || null, evidence: clip(`${id}: ${finding}`) });
  }
  r.tested = [...hosts];
  return r;
}

const TLS_TITLES: Record<string, string> = {
  SSLv2: "Povolen protokol SSLv2",
  SSLv3: "Povolen protokol SSLv3",
  "TLS1": "Povolen zastaralý TLS 1.0",
  "TLS1_1": "Povolen zastaralý TLS 1.1",
  cert_expirationStatus: "Certifikát vypršel nebo brzy vyprší",
  cert_chain_of_trust: "Certifikát není důvěryhodný (řetězec)",
  cert_trust: "Certifikát neodpovídá názvu serveru",
  heartbleed: "Zranitelnost Heartbleed",
  ROBOT: "Zranitelnost ROBOT",
  BREACH: "Možný útok BREACH (komprese HTTP)",
  POODLE_SSL: "Zranitelnost POODLE",
  SWEET32: "Zranitelnost SWEET32 (3DES)",
  LOGJAM: "Zranitelnost LOGJAM (slabý DH)",
  "FREAK": "Zranitelnost FREAK",
  "DROWN": "Zranitelnost DROWN",
  "BEAST": "Zranitelnost BEAST",
  "LUCKY13": "Zranitelnost LUCKY13 (CBC)",
  "RC4": "Povolené šifry RC4",
  HSTS: "Chybí HSTS",
};
function tlsTitle(id: string, finding: string) {
  if (TLS_TITLES[id]) return TLS_TITLES[id];
  if (/^cipherlist_/.test(id)) return `Slabé šifry: ${id.replace("cipherlist_", "")}`;
  return clip(`TLS ${id}: ${finding}`, 200);
}

/* ---------- ssh-audit JSON ---------- */

function parseSshAudit(text: string): SecTestParseResult {
  const r = empty();
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    r.warnings.push("Výstup ssh-audit není JSON (-j).");
    return r;
  }
  for (const a of arr<any>(j)) {
    const target = s(a.target);
    const host = target.includes(":") ? target.slice(0, target.lastIndexOf(":")).replace(/^\[|\]$/g, "") : target;
    const port = Number(target.slice(target.lastIndexOf(":") + 1)) || null;
    if (!host) continue;
    r.tested.push(host);
    const banner = [s(a.banner?.software), s(a.banner?.protocol)].filter(Boolean).join(" ");
    for (const c of arr<any>(a.cves)) {
      const cvss = Number(c.cvssv2 ?? c.cvss) || 0;
      r.findings.push({ code: `ssh.cve.${s(c.name)}`, severity: cvss >= 9 ? "critical" : cvss >= 7 ? "high" : cvss >= 4 ? "medium" : "low", title: `SSH server: ${s(c.name)}`, detail: clip(s(c.description), 1000), host, port, evidence: banner });
    }
    for (const cat of ["kex", "key", "enc", "mac"] as const) {
      for (const alg of arr<any>(a[cat])) {
        const fail = arr<string>(alg.notes?.fail);
        const warn = arr<string>(alg.notes?.warn);
        if (!fail.length && !warn.length) continue;
        const name = s(alg.algorithm);
        r.findings.push({
          code: `ssh.${cat}.${name}`,
          severity: fail.length ? "medium" : "low",
          title: `${SSH_CAT[cat]}: ${name}`,
          detail: [...fail, ...warn].join("; ").slice(0, 1000),
          host,
          port,
          evidence: banner,
        });
      }
    }
  }
  return r;
}
const SSH_CAT = { kex: "Slabá výměna klíčů", key: "Slabý klíč hostitele", enc: "Slabá šifra", mac: "Slabý MAC" } as const;

/* ---------- bezpečnostní hlavičky (výstup sondy) ---------- */

export interface HeadersProbeOutput {
  url: string;
  finalUrl?: string;
  status?: number;
  headers?: Record<string, string>;
  cookies?: { name: string; secure: boolean; httponly: boolean; samesite: string }[];
  httpRedirectsToHttps?: boolean | null;
  error?: string;
}

function parseHeaders(text: string): SecTestParseResult {
  const r = empty();
  let list: HeadersProbeOutput[];
  try {
    const j = JSON.parse(text);
    list = Array.isArray(j) ? j : [j];
  } catch {
    r.warnings.push("Výstup kontroly hlaviček není JSON.");
    return r;
  }
  for (const o of list) {
    let u: URL;
    try {
      u = new URL(o.finalUrl || o.url);
    } catch {
      continue;
    }
    const host = u.hostname;
    const port = Number(u.port) || (u.protocol === "https:" ? 443 : 80);
    r.tested.push(host);
    if (o.error) {
      r.warnings.push(`${o.url}: ${o.error}`);
      continue;
    }
    const h = Object.fromEntries(Object.entries(o.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const add = (code: string, severity: SecTestSeverity, title: string, detail: string, evidence = "") => r.findings.push({ code: `web.${code}`, severity, title, detail, host, port, evidence: clip(evidence || `${o.url}`) });
    const https = u.protocol === "https:";
    if (https && !h["strict-transport-security"]) add("hsts", "medium", "Chybí HSTS", "Prohlížeč může být sveden na HTTP. Doplňte Strict-Transport-Security: max-age=31536000; includeSubDomains.");
    if (https && h["strict-transport-security"] && /max-age=(\d+)/.test(h["strict-transport-security"]) && Number(RegExp.$1) < 15552000) add("hsts_short", "low", "HSTS s krátkou platností", "Doporučená max-age je alespoň 6 měsíců (15552000).", h["strict-transport-security"]);
    if (!h["content-security-policy"]) add("csp", "low", "Chybí Content-Security-Policy", "CSP omezuje dopad XSS. Začněte politikou default-src 'self' a postupně ji upřesněte.");
    if (!h["x-frame-options"] && !/frame-ancestors/i.test(h["content-security-policy"] ?? "")) add("frame", "low", "Chybí ochrana proti clickjackingu", "Doplňte X-Frame-Options: DENY nebo CSP frame-ancestors 'none'.");
    if ((h["x-content-type-options"] ?? "").toLowerCase() !== "nosniff") add("nosniff", "low", "Chybí X-Content-Type-Options: nosniff", "Prohlížeč pak může odhadovat typ obsahu (MIME sniffing).");
    if (/\d/.test(h["server"] ?? "")) add("server_version", "low", "Server prozrazuje verzi", "Skryjte verzi (nginx: server_tokens off; Apache: ServerTokens Prod).", `Server: ${h["server"]}`);
    if (h["x-powered-by"]) add("powered_by", "low", "Hlavička X-Powered-By prozrazuje technologii", "Odstraňte hlavičku (PHP: expose_php = Off; Express: app.disable('x-powered-by')).", `X-Powered-By: ${h["x-powered-by"]}`);
    for (const c of o.cookies ?? []) {
      if (https && !c.secure) add(`cookie_secure.${c.name}`, "medium", `Cookie ${c.name} bez příznaku Secure`, "Cookie se může odeslat i po HTTP. Nastavte Secure.");
      if (!c.httponly && /sess|auth|token|jwt|sid/i.test(c.name)) add(`cookie_httponly.${c.name}`, "medium", `Relační cookie ${c.name} bez HttpOnly`, "Cookie je čitelná ze skriptu (XSS). Nastavte HttpOnly.");
    }
    if (o.httpRedirectsToHttps === false) add("no_https_redirect", "medium", "HTTP nepřesměruje na HTTPS", "Na portu 80 nastavte trvalé přesměrování (301) na HTTPS.");
  }
  return r;
}

/* ---------- nikto JSON ---------- */

function parseNikto(text: string): SecTestParseResult {
  const r = empty();
  let j: any;
  try {
    j = JSON.parse(text.replace(/,\s*\]/g, "]"));
  } catch {
    r.warnings.push("Výstup nikto není JSON (-Format json).");
    return r;
  }
  for (const h of arr<any>(j)) {
    const host = s(h.host) || s(h.ip);
    const port = Number(h.port) || null;
    if (!host) continue;
    r.tested.push(host);
    for (const v of arr<any>(h.vulnerabilities)) {
      const msg = s(v.msg);
      if (!msg || /retrieved x-powered-by|anti-clickjacking|x-content-type-options|strict-transport-security|uncommon header/i.test(msg)) continue; // hlavičky řeší web.headers
      const sev: SecTestSeverity = /default (account|password|credential)|admin(istrat)?(ion)? (login|interface|page)|phpmyadmin|backup|\.git\/|directory indexing|remote file|sql/i.test(msg) ? "medium" : "low";
      r.findings.push({ code: `nikto.${s(v.id) || msg.slice(0, 60)}`, severity: sev, title: clip(msg, 200), detail: [s(v.method), s(v.url), s(v.references)].filter(Boolean).join(" · "), host, port, evidence: clip(`${s(v.method)} ${s(v.url)} – ${msg}`) });
    }
  }
  return r;
}

/* ---------- netexec (text) ---------- */

function nxcFlags(text: string, target: string) {
  const t = stripAnsi(text);
  const head = t.match(/^(SMB|LDAP)\s+(\S+)\s+(\d+)\s+(\S+)\s+\[\*\]\s+(.+)$/m);
  return { t, host: head?.[2] || target, port: head ? Number(head[3]) : null, info: head?.[5] ?? "" };
}

function parseNxcNull(text: string, target: string): SecTestParseResult {
  const r = empty();
  const { t, host, info } = nxcFlags(text, target);
  if (!host) {
    r.warnings.push("Ve výstupu netexec chybí cíl – zadejte ho při importu.");
    return r;
  }
  r.tested.push(host);
  if (/\(signing:False\)/i.test(info)) r.findings.push({ code: "smb.signing_not_required", severity: "medium", title: "SMB nevyžaduje podepisování", detail: "Bez povinného podepisování je možný útok NTLM relay.", host, port: 445, evidence: clip(info) });
  if (/\(SMBv1:True\)/i.test(info)) r.findings.push({ code: "smb.v1", severity: "high", title: "Server povoluje SMBv1", detail: "SMBv1 je zastaralý a zneužívaný. Vypněte ho.", host, port: 445, evidence: clip(info) });
  const shares = [...t.matchAll(/^SMB\s+\S+\s+\d+\s+\S+\s+(\S+)\s+(READ(?:,WRITE)?|WRITE)\b(.*)$/gm)].map((m) => `${m[1]} ${m[2]}`);
  const nullOk = /\[\+\][^\n]*\\:/.test(t) && !/STATUS_ACCESS_DENIED|STATUS_LOGON_FAILURE/.test(t);
  if (shares.length) r.findings.push({ code: "smb.null_shares", severity: shares.some((x) => /WRITE/.test(x)) ? "critical" : "high", title: "Sdílené složky čitelné bez hesla", detail: "Anonymní relace vypíše a čte sdílené složky. Vypněte anonymní přístup (RestrictAnonymous, oprávnění sdílení) a odeberte Everyone / Anonymous.", host, port: 445, evidence: shares.join(", ") });
  else if (nullOk) r.findings.push({ code: "smb.null_session", severity: "medium", title: "Server přijme anonymní (null) relaci", detail: "Anonymní relace může vyzradit uživatele a skupiny. Nastavte RestrictAnonymous = 1 a RestrictNullSessAccess = 1.", host, port: 445, evidence: clip(t.split("\n").filter((l) => l.includes("[+]")).join("\n")) });
  return r;
}

function parseNxcLdap(text: string, target: string): SecTestParseResult {
  const r = empty();
  const { t, host } = nxcFlags(text, target);
  if (!host) {
    r.warnings.push("Ve výstupu netexec chybí cíl – zadejte ho při importu.");
    return r;
  }
  r.tested.push(host);
  if (/\(signing:None\)|signing:\s*not required/i.test(t)) r.findings.push({ code: "ldap.signing", severity: "medium", title: "LDAP nevyžaduje podepisování", detail: "Umožňuje relay útoky na řadič domény. GPO „Domain controller: LDAP server signing requirements“ = Require signing.", host, port: 389, evidence: clip(t.split("\n").find((l) => /signing/i.test(l)) ?? "") });
  if (/channel binding:\s*(Never|No TLS cert)/i.test(t)) r.findings.push({ code: "ldap.channel_binding", severity: "low", title: "LDAPS bez channel binding", detail: "Nastavte LdapEnforceChannelBinding = 2 (vždy) po ověření kompatibility klientů.", host, port: 636, evidence: clip(t.split("\n").find((l) => /channel binding/i.test(l)) ?? "") });
  return r;
}

/** Výstup nástroje → nálezy. `target` = cíl z úlohy (pro výstupy, které ho neobsahují). */
export function parseSecTest(testId: SecTestId, text: string, target = ""): SecTestParseResult {
  const t = text.trim();
  if (!t) return { ...empty(), warnings: ["Prázdný výstup."] };
  switch (testId) {
    case "net.ports":
    case "net.services":
      return parseNmapPorts(t, testId);
    case "win.smb":
      return parseNmapSmb(t);
    case "net.udp":
      return parseNmapPorts(t, testId);
    case "win.rdp":
    case "svc.ftp":
    case "svc.smtp":
    case "svc.db":
    case "svc.snmp":
    case "svc.nfs":
    case "svc.vnc":
      return parseNmapScripts(t);
    case "web.paths":
      return parsePaths(t);
    case "dns.axfr":
      return parseAxfr(t, target);
    case "tls.testssl":
      return parseTestssl(t);
    case "ssh.audit":
      return parseSshAudit(t);
    case "web.headers":
      return parseHeaders(t);
    case "web.nikto":
      return parseNikto(t);
    case "win.null":
      return parseNxcNull(t, target);
    case "win.ldap":
      return parseNxcLdap(t, target);
  }
}

/** Sloučení výsledků z více výstupů (sonda pouští nástroj po cílech). */
export function mergeResults(parts: SecTestParseResult[]): SecTestParseResult {
  const facts = new Map<string, SecTestHostFacts>();
  for (const p of parts) for (const f of p.facts) facts.set(f.host, { ...f, ports: [...(facts.get(f.host)?.ports ?? []), ...f.ports] });
  const seen = new Set<string>();
  const findings: SecTestFinding[] = [];
  for (const p of parts)
    for (const f of p.findings) {
      const k = `${f.code}|${f.host}|${f.port ?? ""}`;
      if (!seen.has(k)) {
        seen.add(k);
        findings.push(f);
      }
    }
  return { findings: findings.slice(0, 5000), facts: [...facts.values()], tested: [...new Set(parts.flatMap((p) => p.tested))], warnings: parts.flatMap((p) => p.warnings).slice(0, 50) };
}
