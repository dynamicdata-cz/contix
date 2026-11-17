import { z } from "zod";

/* ============================================================
 * Bezpečnostní testy (v1.56, ADR-153): katalog testů, schválený rozsah cílů, úlohy pro sondu (Kali Linux)
 * a ruční import výstupů nástrojů. Sonda dostane jen ID testu, cíle a porty – příkaz si sestaví sama
 * z vlastního katalogu (CONTIX nikdy neposílá příkaz k provedení). Výstupy parsuje CONTIX (jedno místo pravidel).
 * ============================================================ */

export const SECTEST_CATEGORIES = ["network", "tls", "ssh", "web", "windows"] as const;
export type SecTestCategory = (typeof SECTEST_CATEGORIES)[number];
export const SECTEST_CATEGORY_LABELS: Record<SecTestCategory, string> = {
  network: "Síť a porty",
  tls: "TLS",
  ssh: "SSH",
  web: "Web",
  windows: "Windows a AD",
};

export const SECTEST_IDS = [
  "net.ports",
  "net.services",
  "net.udp",
  "tls.testssl",
  "ssh.audit",
  "web.headers",
  "web.nikto",
  "web.paths",
  "win.smb",
  "win.null",
  "win.ldap",
  "win.rdp",
  "svc.ftp",
  "svc.smtp",
  "svc.db",
  "svc.snmp",
  "svc.nfs",
  "svc.vnc",
  "dns.axfr",
] as const;
export type SecTestId = (typeof SECTEST_IDS)[number];

/** Oblast řízení bezpečnosti, ke které test podává důkaz (pro vazbu na opatření a zprávu). */
export const SECTEST_AREAS = ["network_security", "vulnerability_management", "cryptography", "access_control", "secure_configuration", "web_security"] as const;
export type SecTestArea = (typeof SECTEST_AREAS)[number];
export const SECTEST_AREA_LABELS: Record<SecTestArea, string> = {
  network_security: "Bezpečnost komunikační sítě",
  vulnerability_management: "Řízení technických zranitelností",
  cryptography: "Kryptografické prostředky",
  access_control: "Řízení přístupu a autentizace",
  secure_configuration: "Bezpečná konfigurace systémů",
  web_security: "Bezpečnost webových aplikací",
};

export interface SecTestDef {
  id: SecTestId;
  category: SecTestCategory;
  name: string;
  description: string;
  /** Nástroj na sondě (balíček v Kali). `builtin` = sonda bez externího nástroje. */
  tool: string;
  /** Ukázka příkazu pro ruční spuštění a import. */
  command: string;
  /** Cíl: hostitel / IP / rozsah, nebo URL. */
  target: "host" | "url";
  /** Výchozí porty (prázdné = podle nástroje). */
  ports: number[];
  /** Formát výstupu pro ruční import. */
  importFormat: "nmap-xml" | "testssl-json" | "ssh-audit-json" | "headers-json" | "nikto-json" | "paths-json" | "text";
  areas: SecTestArea[];
  /** Doporučené navazující testy (deterministicky; AI může navrhnout další). */
  next: SecTestId[];
}

export const SECURITY_TESTS: SecTestDef[] = [
  {
    id: "net.ports",
    category: "network",
    name: "Otevřené porty (TCP top 1000)",
    description: "Najde dostupné TCP porty a upozorní na rizikové služby dostupné ze sítě (Telnet, databáze, RDP, VNC, Docker API, Redis…).",
    tool: "nmap",
    command: "nmap -Pn -sT --top-ports 1000 -T3 --open -oX vystup.xml 192.0.2.10",
    target: "host",
    ports: [],
    importFormat: "nmap-xml",
    areas: ["network_security"],
    next: ["net.services", "tls.testssl", "ssh.audit", "web.headers", "win.smb"],
  },
  {
    id: "net.services",
    category: "network",
    name: "Verze služeb",
    description: "Zjistí produkty a verze služeb na zadaných portech – podklad pro zranitelnosti a zastaralé verze.",
    tool: "nmap",
    command: "nmap -Pn -sT -sV --version-light -p 22,80,443 --open -oX vystup.xml 192.0.2.10",
    target: "host",
    ports: [21, 22, 25, 80, 110, 143, 443, 445, 3306, 3389, 5432, 8080, 8443],
    importFormat: "nmap-xml",
    areas: ["vulnerability_management", "network_security"],
    next: ["tls.testssl", "ssh.audit", "web.nikto"],
  },
  {
    id: "tls.testssl",
    category: "tls",
    name: "TLS konfigurace (testssl.sh)",
    description: "Protokoly, šifry, certifikát (platnost, řetězec, délka klíče), známé zranitelnosti TLS (Heartbleed, ROBOT…).",
    tool: "testssl.sh",
    command: "testssl --quiet --color 0 --jsonfile vystup.json 192.0.2.10:443",
    target: "host",
    ports: [443],
    importFormat: "testssl-json",
    areas: ["cryptography"],
    next: ["web.headers"],
  },
  {
    id: "ssh.audit",
    category: "ssh",
    name: "SSH algoritmy (ssh-audit)",
    description: "Slabé algoritmy výměny klíčů, šifer, MAC a klíčů hostitele, známé CVE verze serveru.",
    tool: "ssh-audit",
    command: "ssh-audit -j -p 22 192.0.2.10 > vystup.json",
    target: "host",
    ports: [22],
    importFormat: "ssh-audit-json",
    areas: ["cryptography", "secure_configuration"],
    next: [],
  },
  {
    id: "web.headers",
    category: "web",
    name: "Bezpečnostní hlavičky webu",
    description: "HSTS, CSP, X-Frame-Options, X-Content-Type-Options, prozrazená verze serveru, příznaky cookies a přesměrování na HTTPS. Jen jeden požadavek GET.",
    tool: "builtin",
    command: "(sonda CONTIX – bez externího nástroje)",
    target: "url",
    ports: [],
    importFormat: "headers-json",
    areas: ["web_security"],
    next: ["web.nikto", "tls.testssl"],
  },
  {
    id: "web.nikto",
    category: "web",
    name: "Webový server (nikto)",
    description: "Známé problémy webového serveru: výchozí soubory, administrační rozhraní, zastaralý software, nebezpečné metody. Neútočí na logiku aplikace.",
    tool: "nikto",
    command: "nikto -h https://web.firma.cz -Format json -o vystup.json -ask no -maxtime 600s",
    target: "url",
    ports: [],
    importFormat: "nikto-json",
    areas: ["web_security", "vulnerability_management"],
    next: [],
  },
  {
    id: "win.smb",
    category: "windows",
    name: "SMB podepisování a SMBv1",
    description: "Zda server vyžaduje podepisování SMB (ochrana proti NTLM relay) a zda povoluje zastaralé SMBv1.",
    tool: "nmap",
    command: "nmap -Pn -p 445 --script smb2-security-mode,smb-protocols -oX vystup.xml 192.0.2.20",
    target: "host",
    ports: [445],
    importFormat: "nmap-xml",
    areas: ["secure_configuration", "network_security"],
    next: ["win.null", "win.ldap"],
  },
  {
    id: "win.null",
    category: "windows",
    name: "Anonymní přístup ke sdíleným složkám",
    description: "Zkusí anonymní (null) relaci a výpis sdílených složek bez hesla. Nic nezapisuje.",
    tool: "netexec",
    command: "nxc smb 192.0.2.20 -u '' -p '' --shares > vystup.txt",
    target: "host",
    ports: [445],
    importFormat: "text",
    areas: ["access_control"],
    next: [],
  },
  {
    id: "win.ldap",
    category: "windows",
    name: "LDAP podepisování (řadič domény)",
    description: "Zda řadič domény vyžaduje podepisování LDAP a channel binding (ochrana proti relay útokům).",
    tool: "netexec",
    command: "nxc ldap 192.0.2.20 > vystup.txt",
    target: "host",
    ports: [389],
    importFormat: "text",
    areas: ["access_control", "secure_configuration"],
    next: [],
  },
  /* ---------- rozšíření v1.60 ---------- */
  {
    id: "net.udp",
    category: "network",
    name: "UDP služby (top 50)",
    description: "Najde otevřené UDP služby, které bývají zneužitelné: SNMP, TFTP, IPMI, SSDP, Memcached, NetBIOS. UDP sken je pomalejší a méně spolehlivý.",
    tool: "nmap",
    command: "sudo nmap -sU --top-ports 50 -Pn --open -oX vystup.xml 192.0.2.10",
    target: "host",
    ports: [],
    importFormat: "nmap-xml",
    areas: ["network_security"],
    next: ["svc.snmp"],
  },
  {
    id: "web.paths",
    category: "web",
    name: "Citlivé soubory na webu",
    description: "Ověří desítky známých citlivých cest (/.git, /.env, zálohy, phpinfo, server-status, Spring Actuator, administrace) – jen požadavky GET, nic se nezapisuje.",
    tool: "builtin",
    command: "(sonda CONTIX – bez externího nástroje)",
    target: "url",
    ports: [],
    importFormat: "paths-json",
    areas: ["web_security"],
    next: ["web.nikto"],
  },
  {
    id: "win.rdp",
    category: "windows",
    name: "RDP – ověření na úrovni sítě (NLA)",
    description: "Zda vzdálená plocha vyžaduje NLA (CredSSP) a nepovoluje zastaralé šifrování; bez NLA je přihlašovací obrazovka dostupná komukoli a server je zranitelnější.",
    tool: "nmap",
    command: "nmap -Pn -p 3389 --script rdp-enum-encryption -oX vystup.xml 192.0.2.20",
    target: "host",
    ports: [3389],
    importFormat: "nmap-xml",
    areas: ["access_control", "secure_configuration"],
    next: [],
  },
  {
    id: "svc.ftp",
    category: "network",
    name: "FTP – anonymní přístup",
    description: "Zda FTP server povoluje anonymní přihlášení a co je vidět; jen čtení výpisu adresáře.",
    tool: "nmap",
    command: "nmap -Pn -p 21 --script ftp-anon,ftp-syst -oX vystup.xml 192.0.2.10",
    target: "host",
    ports: [21],
    importFormat: "nmap-xml",
    areas: ["access_control"],
    next: [],
  },
  {
    id: "svc.smtp",
    category: "network",
    name: "Poštovní server (open relay, STARTTLS)",
    description: "Zda SMTP server nepředává poštu komukoli (open relay) a nabízí šifrování STARTTLS. Test relay posílá jen příkazy RCPT bez odeslání zprávy.",
    tool: "nmap",
    command: "nmap -Pn -p 25,587 --script smtp-commands,smtp-open-relay -oX vystup.xml 192.0.2.30",
    target: "host",
    ports: [25, 587],
    importFormat: "nmap-xml",
    areas: ["network_security", "secure_configuration"],
    next: ["tls.testssl"],
  },
  {
    id: "svc.db",
    category: "network",
    name: "Databáze bez hesla",
    description: "MySQL / MariaDB a MS SQL s prázdným heslem správce, MongoDB, Redis a Elasticsearch bez ověření. Jen pokus o přihlášení prázdným heslem a čtení informací o serveru.",
    tool: "nmap",
    command: "nmap -Pn -p 1433,3306,5432,6379,9200,27017 --script mysql-empty-password,ms-sql-empty-password,mongodb-info,redis-info,http-title -oX vystup.xml 192.0.2.40",
    target: "host",
    ports: [1433, 3306, 6379, 9200, 27017],
    importFormat: "nmap-xml",
    areas: ["access_control", "secure_configuration"],
    next: [],
  },
  {
    id: "svc.snmp",
    category: "network",
    name: "SNMP s výchozí komunitou",
    description: "Zda zařízení odpovídá na SNMP s komunitou „public“ – prozradí konfiguraci, rozhraní a často i síťové cesty.",
    tool: "nmap",
    command: "sudo nmap -sU -Pn -p 161 --script snmp-sysdescr -oX vystup.xml 192.0.2.1",
    target: "host",
    ports: [161],
    importFormat: "nmap-xml",
    areas: ["secure_configuration", "network_security"],
    next: [],
  },
  {
    id: "svc.nfs",
    category: "network",
    name: "NFS exporty",
    description: "Které adresáře server sdílí přes NFS a komu – export pro všechny (*) je vysoké riziko.",
    tool: "nmap",
    command: "nmap -Pn -p 111,2049 --script nfs-showmount -oX vystup.xml 192.0.2.50",
    target: "host",
    ports: [111, 2049],
    importFormat: "nmap-xml",
    areas: ["access_control"],
    next: [],
  },
  {
    id: "svc.vnc",
    category: "network",
    name: "VNC bez hesla",
    description: "Zda VNC server nabízí přístup bez ověření (security type None).",
    tool: "nmap",
    command: "nmap -Pn -p 5900-5903 --script vnc-info -oX vystup.xml 192.0.2.60",
    target: "host",
    ports: [5900, 5901],
    importFormat: "nmap-xml",
    areas: ["access_control"],
    next: [],
  },
  {
    id: "dns.axfr",
    category: "network",
    name: "Přenos DNS zóny (AXFR)",
    description: "Zda jmenné servery domény povolí komukoli stáhnout celou zónu (seznam všech serverů a služeb). Cíl = název domény.",
    tool: "dig",
    command: "dig +short NS firma.cz; dig axfr firma.cz @ns1.firma.cz > vystup.txt",
    target: "host",
    ports: [53],
    importFormat: "text",
    areas: ["network_security"],
    next: [],
  },
];

export const secTestDef = (id: string): SecTestDef | undefined => SECURITY_TESTS.find((t) => t.id === id);

/* ---------- cíle a rozsah ---------- */

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/** Cíl testu: IPv4, IPv4/CIDR (od /16), hostname, nebo URL http(s). Nic jiného – chrání sondu před injekcí voleb. */
export function parseTarget(raw: string): { kind: "ip" | "cidr" | "host" | "url"; value: string; host: string } | null {
  const v = raw.trim();
  if (!v || v.length > 300 || v.startsWith("-")) return null;
  if (/^https?:\/\//i.test(v)) {
    const u = v.match(/^(https?):\/\/([^/:?#@\s]+)(:\d{1,5})?([/?#][^\s]*)?$/i);
    if (!u) return null;
    const host = u[2]!.toLowerCase();
    if (!IPV4.test(host) && !HOSTNAME.test(host)) return null;
    return { kind: "url", value: `${u[1]!.toLowerCase()}://${host}${u[3] ?? ""}${u[4] ?? "/"}`, host };
  }
  const m = v.match(/^([\d.]+)\/(\d{1,2})$/);
  if (m) return IPV4.test(m[1]!) && Number(m[2]) >= 16 && Number(m[2]) <= 32 ? { kind: "cidr", value: v, host: m[1]! } : null;
  if (IPV4.test(v)) return { kind: "ip", value: v, host: v };
  if (HOSTNAME.test(v)) return { kind: "host", value: v.toLowerCase(), host: v.toLowerCase() };
  return null;
}

const ipNum = (ip: string) => ip.split(".").reduce((a, b) => a * 256 + Number(b), 0);
function inCidr(ip: string, cidr: string) {
  const [base, bits] = cidr.split("/");
  const size = 2 ** (32 - Number(bits));
  const start = Math.floor(ipNum(base!) / size) * size;
  const x = ipNum(ip);
  return x >= start && x < start + size;
}
function cidrInside(inner: string, outer: string) {
  const [b, bits] = inner.split("/");
  return Number(bits) >= Number(outer.split("/")[1]) && inCidr(b!, outer);
}
const cidrOverlap = (a: string, b: string) => cidrInside(a, b) || cidrInside(b, a);
/** Položka rozsahu pokrývá hostitele (IP v rozsahu, přesný název, nebo *.doména). */
function entryCovers(entry: string, t: NonNullable<ReturnType<typeof parseTarget>>): boolean {
  const e = entry.trim().toLowerCase();
  if (!e) return false;
  if (e.startsWith("*.")) return t.kind !== "ip" && t.kind !== "cidr" && t.host.endsWith(e.slice(1));
  const pe = parseTarget(e);
  if (!pe) return false;
  if (pe.kind === "cidr") return t.kind === "cidr" ? cidrInside(t.value, pe.value) : IPV4.test(t.host) && inCidr(t.host, pe.value);
  if (t.kind === "cidr") return false;
  return pe.host === t.host;
}

/** Je cíl ve schváleném rozsahu a mimo výjimky? Vrací důvod odmítnutí, nebo null. */
export function scopeAllows(scope: { targets: string[]; exclusions: string[] }, raw: string): string | null {
  const t = parseTarget(raw);
  if (!t) return "neplatný cíl";
  if (!scope.targets.some((e) => entryCovers(e, t))) return "mimo schválený rozsah";
  const hitsExclusion = (e: string) => {
    if (entryCovers(e, t)) return true;
    if (t.kind !== "cidr") return false;
    const pe = parseTarget(e);
    return !!pe && (pe.kind === "ip" ? inCidr(pe.host, t.value) : pe.kind === "cidr" ? cidrOverlap(pe.value, t.value) : false);
  };
  if (scope.exclusions.some(hitsExclusion)) return "zasahuje do výjimky z rozsahu";
  return null;
}

export const SecTestScopeInput = z.object({
  companyId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(200),
  /** Co smí být testováno: IP, CIDR (od /16), hostname, *.doména. */
  targets: z
    .array(z.string().trim().min(1).max(300))
    .min(1)
    .max(500)
    .refine((a) => a.every((x) => (x.startsWith("*.") ? HOSTNAME.test(x.slice(2)) : !!parseTarget(x))), "Neplatná položka rozsahu (IP, CIDR od /16, název serveru, *.doména nebo URL)"),
  exclusions: z
    .array(z.string().trim().min(1).max(300))
    .max(500)
    .refine((a) => a.every((x) => (x.startsWith("*.") ? HOSTNAME.test(x.slice(2)) : !!parseTarget(x))), "Neplatná výjimka")
    .default([]),
  validFrom: z.string().date(),
  validTo: z.string().date(),
  /** Podklad oprávnění (objednávka, smlouva, souhlas vlastníka systému). */
  authorization: z.string().trim().min(3).max(2000),
  /** Povolené kategorie testů. */
  categories: z.array(z.enum(SECTEST_CATEGORIES)).min(1).default([...SECTEST_CATEGORIES]),
  note: z.string().trim().max(2000).nullable().optional(),
});
export type SecTestScopeInput = z.input<typeof SecTestScopeInput>;

export interface SecTestScopeDto {
  id: string;
  companyId: string;
  name: string;
  targets: string[];
  exclusions: string[];
  validFrom: string;
  validTo: string;
  authorization: string;
  categories: SecTestCategory[];
  note: string | null;
  status: "draft" | "approved" | "expired";
  createdByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  runs: number;
}

export const SecTestRunInput = z.object({
  scopeId: z.string().uuid(),
  testId: z.enum(SECTEST_IDS),
  targets: z.array(z.string().trim().min(1).max(300)).min(1).max(256),
  ports: z.array(z.number().int().min(1).max(65535)).max(100).default([]),
  /** Konkrétní sonda (null = libovolná zapnutá sonda společnosti). */
  probeId: z.string().uuid().nullable().default(null),
});
export type SecTestRunInput = z.input<typeof SecTestRunInput>;

export const SecTestImportInput = z.object({
  scopeId: z.string().uuid(),
  testId: z.enum(SECTEST_IDS),
  /** Cíl, pokud ho výstup neobsahuje (text netexec, hlavičky). */
  target: z.string().trim().max(300).default(""),
  fileName: z.string().trim().max(255).default(""),
  content: z.string().min(1).max(8 * 1024 * 1024),
});
export type SecTestImportInput = z.input<typeof SecTestImportInput>;

/** Sady testů (v1.56.1) – předvolby pro typické cíle. */
export const SECTEST_PRESETS: { id: string; name: string; tests: SecTestId[] }[] = [
  { id: "server", name: "Linux server", tests: ["net.ports", "net.services", "ssh.audit", "tls.testssl"] },
  { id: "web", name: "Webová aplikace", tests: ["web.headers", "tls.testssl", "web.nikto"] },
  { id: "windows", name: "Windows a řadič domény", tests: ["net.ports", "win.smb", "win.null", "win.ldap"] },
  { id: "network", name: "Průzkum sítě", tests: ["net.ports"] },
  { id: "services", name: "Služby a databáze", tests: ["net.ports", "net.udp", "svc.ftp", "svc.smtp", "svc.db", "svc.snmp", "svc.nfs", "svc.vnc"] },
  { id: "full", name: "Kompletní server", tests: ["net.ports", "net.services", "net.udp", "ssh.audit", "tls.testssl", "svc.db", "svc.ftp", "svc.nfs"] },
];

/** Více testů najednou (sada): stejné cíle, každý test vlastní běh; volitelně navazující testy a AI. */
export const SecTestBatchInput = z.object({
  scopeId: z.string().uuid(),
  name: z.string().trim().max(200).default(""),
  testIds: z.array(z.enum(SECTEST_IDS)).min(1).max(SECTEST_IDS.length),
  targets: z.array(z.string().trim().min(1).max(300)).min(1).max(256),
  ports: z.array(z.number().int().min(1).max(65535)).max(100).default([]),
  probeId: z.string().uuid().nullable().default(null),
  /** Po průzkumu portů automaticky zařadit navazující testy podle nalezených služeb (SSH → ssh-audit, 443 → TLS a hlavičky…). */
  autoFollow: z.boolean().default(true),
  /** Po dokončení: AI rozbor závažných nálezů, shrnutí běhů a celé sady (lokální model). */
  autoAi: z.boolean().default(false),
  /** Po dokončení založit úkoly na odstranění nálezů (střední a vyšší) technickým garantům aktiv (v1.60). */
  autoTasks: z.boolean().default(false),
});
export type SecTestBatchInput = z.input<typeof SecTestBatchInput>;

export interface SecTestBatchDto {
  id: string;
  companyId: string;
  scopeId: string;
  scopeName: string;
  name: string;
  autoFollow: boolean;
  autoAi: boolean;
  autoTasks: boolean;
  /** Sada z plánu pravidelných testů (v1.63) a rozdíl proti předchozímu stavu: nově zjištěné a opravené nálezy. */
  scheduleId: string | null;
  diff: { new: number; fixed: number; newHigh: number } | null;
  requestedByName: string | null;
  createdAt: string;
  runs: SecTestRunDto[];
  /** queued / running / done (vše doběhlo) */
  status: "running" | "done";
  stats: { findings: number; critical: number; high: number; medium: number; low: number };
  summary: SecTestRunSummary | null;
}

/** Ruční přiřazení nálezu k aktivu; `rememberAddress` doplní cíl do IP / názvu aktiva pro příští běhy. */
export const SecTestAssignInput = z.object({
  assetId: z.string().uuid().nullable(),
  /** Přiřadit i ostatní nálezy stejného cíle. */
  sameHost: z.boolean().default(true),
  rememberAddress: z.boolean().default(true),
});

/** Spustit navržené testy (z AI nebo z navazujících) na cíl nálezu. */
export const SecTestFollowInput = z.object({ testIds: z.array(z.enum(SECTEST_IDS)).min(1).max(SECTEST_IDS.length) });

/** Cíl pro test: hostitelský test z URL vezme hostitele, webový test z hostitele udělá https://hostitel. */
export function targetFor(def: Pick<SecTestDef, "target">, raw: string, port?: number | null): string | null {
  const t = parseTarget(raw);
  if (!t) return null;
  if (def.target === "url") {
    if (t.kind === "url") return t.value;
    if (t.kind === "cidr") return null;
    const https = port == null || ![80, 8000, 8080].includes(port);
    return `${https ? "https" : "http"}://${t.host}${port && ![80, 443].includes(port) ? `:${port}` : ""}/`;
  }
  return t.kind === "url" ? t.host : t.value;
}

/** Navazující testy podle nalezených služeb (deterministicky, bez AI). */
export function followUpsFromFacts(facts: SecTestHostFacts[]): { testId: SecTestId; target: string; ports: number[] }[] {
  const out: { testId: SecTestId; target: string; ports: number[] }[] = [];
  const add = (testId: SecTestId, target: string, ports: number[] = []) => {
    const ex = out.find((x) => x.testId === testId && x.target === target);
    if (ex) ex.ports = [...new Set([...ex.ports, ...ports])];
    else out.push({ testId, target, ports });
  };
  for (const h of facts) {
    for (const p of h.ports) {
      const svc = `${p.service} ${p.product}`.toLowerCase();
      if (p.port === 22 || /\bssh\b/.test(svc)) add("ssh.audit", h.host, [p.port]);
      const tls = [443, 8443, 636, 993, 995, 465, 3389].includes(p.port) || /https|ssl|tls/.test(svc);
      if (tls && p.port !== 3389 && p.port !== 636) add("tls.testssl", h.host, [p.port]);
      if ([443, 8443].includes(p.port) || /https/.test(svc)) add("web.headers", `https://${h.host}${p.port === 443 ? "" : `:${p.port}`}/`);
      else if ([80, 8000, 8080].includes(p.port) || /^http\b/.test(p.service)) add("web.headers", `http://${h.host}${p.port === 80 ? "" : `:${p.port}`}/`);
      if (p.port === 445) {
        add("win.smb", h.host, [445]);
        add("win.null", h.host, [445]);
      }
      if (p.port === 389 || p.port === 636) add("win.ldap", h.host, [389]);
      // rozšíření v1.60: služby podle portu (UDP z net.udp)
      if (p.proto === "udp") {
        if (p.port === 161) add("svc.snmp", h.host, [161]);
        continue;
      }
      if ([443, 8443, 80, 8000, 8080].includes(p.port) || /^https?\b/.test(p.service)) add("web.paths", `${[443, 8443].includes(p.port) || /https/.test(svc) ? "https" : "http"}://${h.host}${[80, 443].includes(p.port) ? "" : `:${p.port}`}/`);
      if (p.port === 21 || /\bftp\b/.test(svc)) add("svc.ftp", h.host, [p.port]);
      if ([25, 465, 587].includes(p.port) || /smtp/.test(svc)) add("svc.smtp", h.host, [p.port]);
      if ([1433, 3306, 5432, 6379, 9200, 27017].includes(p.port)) add("svc.db", h.host, [p.port]);
      if (p.port === 2049 || p.port === 111) add("svc.nfs", h.host, [111, 2049]);
      if (p.port === 3389) add("win.rdp", h.host, [3389]);
      if (p.port >= 5900 && p.port <= 5910) add("svc.vnc", h.host, [p.port]);
    }
  }
  return out;
}

/** Souhrn pro Přehled (v1.57). */
export interface SecTestSummaryDto {
  open: { critical: number; high: number; medium: number; low: number };
  accepted: number;
  fixed30d: number;
  runs30d: number;
  active: number;
  failed30d: number;
  lastRunAt: string | null;
  probes: { total: number; online: number };
  scopesApproved: number;
}

export const SECTEST_RUN_STATUSES = ["queued", "running", "done", "failed", "cancelled"] as const;
export type SecTestRunStatus = (typeof SECTEST_RUN_STATUSES)[number];

export const SECTEST_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type SecTestSeverity = (typeof SECTEST_SEVERITIES)[number];

/** Nález testu (výstup parseru). */
export interface SecTestFinding {
  /** Stálý kód pravidla (např. port.telnet, tls.SSLv3, ssh.kex.diffie-hellman-group1-sha1). */
  code: string;
  severity: SecTestSeverity;
  title: string;
  detail: string;
  host: string;
  port: number | null;
  evidence: string;
}

/** Zjištěné skutečnosti (otevřené porty, služby) – pro přehled a porovnání se sběračem ze serveru. */
export interface SecTestHostFacts {
  host: string;
  hostname: string | null;
  ports: { port: number; proto: string; service: string; product: string; version: string }[];
}

export interface SecTestParseResult {
  findings: SecTestFinding[];
  facts: SecTestHostFacts[];
  /** Hostitelé, kteří byli otestováni (pro uzavření nálezů, které zmizely). */
  tested: string[];
  warnings: string[];
}

export interface SecTestRunDto {
  id: string;
  batchId: string | null;
  parentRunId: string | null;
  companyId: string;
  scopeId: string;
  scopeName: string;
  testId: SecTestId;
  targets: string[];
  ports: number[];
  source: "probe" | "import";
  probeId: string | null;
  probeName: string | null;
  status: SecTestRunStatus;
  error: string | null;
  requestedByName: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  stats: { findings: number; critical: number; high: number; medium: number; low: number; hosts: number };
  facts: SecTestHostFacts[];
  warnings: string[];
  summary: SecTestRunSummary | null;
  /** Ověření opravy nálezu (v1.63). */
  retestFindingId: string | null;
}

export const SECTEST_FINDING_STATUSES = ["open", "fixed", "accepted", "false_positive"] as const;
export type SecTestFindingStatus = (typeof SECTEST_FINDING_STATUSES)[number];
export const SecTestFindingPatch = z
  .object({
    status: z.enum(SECTEST_FINDING_STATUSES),
    note: z.string().trim().max(2000).nullable().optional(),
    /** Přijaté riziko: platnost do (v1.64) – po termínu se nález při dalším testu znovu otevře. */
    until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  })
  .refine((v) => v.status !== "accepted" || (v.note ?? "").length >= 5, { message: "Přijetí rizika vyžaduje zdůvodnění (alespoň 5 znaků)", path: ["note"] });

export interface SecTestFindingDto {
  id: string;
  companyId: string;
  testId: SecTestId;
  code: string;
  severity: SecTestSeverity;
  title: string;
  detail: string;
  host: string;
  port: number | null;
  evidence: string;
  assetId: string | null;
  assetName: string | null;
  status: SecTestFindingStatus;
  note: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  runId: string;
  advice: SecTestAdvice | null;
  /** Úkol na odstranění nálezu (v1.60) – poslední založený. */
  task: SecTestFindingTask | null;
  /** Odpovědné osoby z evidence aktiva (v1.62). */
  owners: { business: string | null; technical: string | null; deputy: string | null } | null;
  /** Kdy test ověřil opravu (stav „fixed“). */
  fixedAt: string | null;
  /** Přijaté riziko (v1.64). */
  acceptedByName: string | null;
  acceptedAt: string | null;
  acceptedUntil: string | null;
  /** Opatření, jehož účinnost nález dokládá (v1.63). */
  controlId: string | null;
  controlLabel: string | null;
}

/* ---------- úkoly na odstranění nálezů (v1.60, ADR-155) ---------- */

/** Lhůta odstranění podle závažnosti (dny); informativní nálezy úkol nedostávají automaticky. */
export const SECTEST_TASK_DUE_DAYS: Record<SecTestSeverity, number> = { critical: 7, high: 14, medium: 30, low: 90, info: 180 };
export const SECTEST_TASK_PRIORITY: Record<SecTestSeverity, "high" | "medium" | "low"> = { critical: "high", high: "high", medium: "medium", low: "low", info: "low" };
/** Automatické úkoly po doběhnutí sady: jen tyto závažnosti. */
export const SECTEST_AUTO_TASK_SEVERITIES: SecTestSeverity[] = ["critical", "high", "medium"];

export interface SecTestFindingTask {
  id: string;
  code: string;
  status: "open" | "in_progress" | "done" | "cancelled";
  dueDate: string | null;
  ownerPositionId: string | null;
  ownerName: string | null;
  /** Odpovědná osoba (technický garant / zástupce / business vlastník aktiva). */
  assigneeName: string | null;
}
/** Komu úkol připadl: technický garant, zástupce, business vlastník, nebo nikomu (nikdo z nich nemá funkci). */
export type SecTestTaskAssignee = "technical" | "deputy" | "business" | "none";

export const SecTestTasksInput = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });
export type SecTestTasksInput = z.infer<typeof SecTestTasksInput>;
export interface SecTestTasksResult {
  created: number;
  /** Nález už má otevřený úkol. */
  existing: number;
  /** Úkol založen, ale bez odpovědné funkce (aktivum nemá garanta / vlastníka s funkcí). */
  unassigned: number;
  /** Nález není otevřený (opravený, přijatý…). */
  skipped: number;
}

/* ---------- AI (lokální model) ---------- */

/** Rozbor nálezu: vysvětlení, dopad, náprava, ověření, navazující testy a opatření organizace. */
export interface SecTestAdvice {
  summary: string;
  impact: string;
  remediation: string[];
  verify: string;
  nextTests: SecTestId[];
  /** ID opatření organizace (ověřená proti katalogu). */
  controlIds: string[];
  model: string;
  generatedAt: string;
}

/** Shrnutí běhu testu pro zprávu. */
export interface SecTestRunSummary {
  management: string;
  technical: string;
  priorities: string[];
  nextTests: SecTestId[];
  model: string;
  generatedAt: string;
}

const pickJson = (text: string): Record<string, unknown> | null => {
  const clean = text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  const a = clean.indexOf("{");
  const b = clean.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(clean.slice(a, b + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
};
const strOf = (v: unknown, n = 4000) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const listOf = (v: unknown, n = 12) => (Array.isArray(v) ? v.map((x) => strOf(x, 1000)).filter(Boolean).slice(0, n) : []);
const testsOf = (v: unknown) => listOf(v).filter((x): x is SecTestId => (SECTEST_IDS as readonly string[]).includes(x));

/** Odpověď modelu → rozbor nálezu; neznámé testy a opatření se zahodí. */
export function parseSecTestAdvice(text: string, allowedControlIds: readonly string[]): Omit<SecTestAdvice, "model" | "generatedAt"> {
  const o = pickJson(text);
  if (!o) return { summary: strOf(text, 4000), impact: "", remediation: [], verify: "", nextTests: [], controlIds: [] };
  return {
    summary: strOf(o.summary),
    impact: strOf(o.impact),
    remediation: listOf(o.remediation),
    verify: strOf(o.verify, 2000),
    nextTests: testsOf(o.nextTests),
    controlIds: listOf(o.controlIds, 10).filter((x) => allowedControlIds.includes(x)),
  };
}

export function parseSecTestSummary(text: string): Omit<SecTestRunSummary, "model" | "generatedAt"> {
  const o = pickJson(text);
  if (!o) return { management: strOf(text, 6000), technical: "", priorities: [], nextTests: [] };
  return { management: strOf(o.management, 6000), technical: strOf(o.technical, 8000), priorities: listOf(o.priorities), nextTests: testsOf(o.nextTests) };
}

/* ---------- sonda (připojení typu probe) ---------- */

export const PROBE_TOKEN_PREFIX = "ctxp_";

export const ProbeConnectionInput = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  companyId: z.string().uuid().nullable().default(null),
});
export type ProbeConnectionInput = z.input<typeof ProbeConnectionInput>;

export interface ProbeConnectionDto {
  id: string;
  kind: "probe";
  name: string;
  enabled: boolean;
  companyId: string | null;
  tokenPrefix: string;
  installerReady: boolean;
  lastSeenAt: string | null;
  hostname: string | null;
  version: string | null;
  /** Nástroje, které sonda hlásí jako dostupné. */
  tools: Record<string, boolean>;
  queued: number;
}

/** Hlášení sondy při dotazu na práci. */
export const ProbePollInput = z.object({
  version: z.string().trim().max(20).default(""),
  hostname: z.string().trim().max(255).default(""),
  tools: z.record(z.string().max(40), z.boolean()).default({}),
});

export const ProbeResultInput = z.object({
  runId: z.string().uuid(),
  error: z.string().max(4000).nullable().default(null),
  outputs: z
    .array(
      z.object({
        target: z.string().max(300),
        port: z.number().int().min(0).max(65535).nullable().default(null),
        exitCode: z.number().int().nullable().default(null),
        stdout: z.string().max(8 * 1024 * 1024),
        stderr: z.string().max(20_000).default(""),
        durationMs: z.number().int().min(0).default(0),
      }),
    )
    .max(512)
    .default([]),
});
export type ProbeResultInput = z.input<typeof ProbeResultInput>;

/* ---------- pravidelné testy (v1.63, ADR-157) ---------- */

export const SECTEST_SCHEDULE_INTERVALS = [1, 7, 14, 30, 90] as const;
export const SecTestScheduleInput = z.object({
  scopeId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  testIds: z.array(z.enum(SECTEST_IDS)).min(1).max(SECTEST_IDS.length),
  targets: z.array(z.string().trim().min(1).max(300)).min(1).max(256),
  ports: z.array(z.number().int().min(1).max(65535)).max(100).default([]),
  probeId: z.string().uuid().nullable().default(null),
  intervalDays: z.number().int().min(1).max(365).default(7),
  autoFollow: z.boolean().default(true),
  autoAi: z.boolean().default(false),
  autoTasks: z.boolean().default(true),
  enabled: z.boolean().default(true),
  /** První spuštění (ISO); výchozí = hned při příštím běhu plánovače. */
  firstRunAt: z.string().datetime({ offset: true }).nullable().optional(),
});
export type SecTestScheduleInput = z.input<typeof SecTestScheduleInput>;

export interface SecTestScheduleDto {
  id: string;
  companyId: string;
  scopeId: string;
  scopeName: string;
  name: string;
  testIds: SecTestId[];
  targets: string[];
  ports: number[];
  probeId: string | null;
  intervalDays: number;
  autoFollow: boolean;
  autoAi: boolean;
  autoTasks: boolean;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  lastError: string | null;
  lastBatch: { id: string; createdAt: string; status: "running" | "done"; stats: SecTestBatchDto["stats"]; diff: SecTestBatchDto["diff"] } | null;
}

/* ---------- zpráva z testů (v1.63) ---------- */

export const SecTestReportQuery = z.object({
  /** Sady testů (čárkou); bez sad = všechny nálezy společnosti v období. */
  batchIds: z.string().max(4000).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Zahrnout i opravené / přijaté nálezy (stav ověření). */
  all: z.enum(["1"]).optional(),
  /** Důkazy (výstupy nástrojů) ve zprávě. */
  evidence: z.enum(["0", "1"]).default("1"),
});
export type SecTestReportQuery = z.input<typeof SecTestReportQuery>;

/** Opatření k nálezu (v1.63) – ruční vazba. */
export const SecTestControlInput = z.object({ controlId: z.string().uuid().nullable() });
