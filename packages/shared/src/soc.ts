import { z } from "zod";
import type { AlertSuggestionDto } from "./alerts";
import type { TiMatch } from "./threatIntel";

/* ============================================================
 * SOC (v0.51, ADR-046): fronta bezpečnostních alertů (Wazuh + ruční), triáž analytikem, eskalace na incident,
 * mapování na MITRE ATT&CK, playbooky a AI poradci na lokálním modelu.
 * ATT&CK® je registrovaná ochranná známka The MITRE Corporation; ID a názvy taktik/technik se uvádějí s odkazem na attack.mitre.org.
 * ============================================================ */

export const SOC_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type SocSeverity = (typeof SOC_SEVERITIES)[number];

/** Závažnost podle úrovně pravidla Wazuh (0–15). */
export function socSeverity(level: number): SocSeverity {
  if (level >= 13) return "critical";
  if (level >= 10) return "high";
  if (level >= 7) return "medium";
  return "low";
}
/* ---------- expozice zranitelnosti (v0.53, ADR-048) ---------- */

/** Techniky zneužití zranitelností – pokus o zneužití na aktivu s vysokou / kritickou zranitelností zvýší závažnost. */
export const EXPLOIT_TECHNIQUES = ["T1190", "T1203", "T1210", "T1068", "T1211", "T1212"];
export const CVE_RE = /CVE-\d{4}-\d{4,7}/gi;

/**
 * Vazba alertu na otevřené zranitelnosti aktiva (počítá se při synchronizaci a v plánovači).
 * cve_match = alert zmiňuje CVE, která je na aktivu otevřená; exploit_technique = technika zneužití + vysoká/kritická
 * zranitelnost; vulnerable_asset = jen informace, aktivum má vysoké/kritické zranitelnosti.
 */
export interface SocExposure {
  exploit: boolean;
  reason: "cve_match" | "exploit_technique" | "vulnerable_asset";
  cves: string[];
  /** Otevřené vysoké a kritické zranitelnosti aktiva. */
  highVulns: number;
}
/** Zvýšení úrovně při pokusu o zneužití zranitelného aktiva: +3 = o jeden stupeň závažnosti. */
export const EXPLOIT_BUMP = 3;
/** Úroveň alertu pro závažnost, řazení a lhůty (pravidlo + případné zvýšení). */
export const effectiveLevel = (ruleLevel: number, exposure: SocExposure | null | undefined) => Math.min(15, ruleLevel + (exposure?.exploit ? EXPLOIT_BUMP : 0));

/** Úroveň pro ručně založený alert. */
export const SEVERITY_LEVEL: Record<SocSeverity, number> = { low: 4, medium: 7, high: 10, critical: 13 };

export const SOC_VERDICTS = ["true_positive", "false_positive", "benign", "undetermined"] as const;
export type SocVerdict = (typeof SOC_VERDICTS)[number];

/** Otevřené stavy fronty (nový = čeká na analytika). */
export const SOC_OPEN_STATUSES = ["new", "in_progress"] as const;

/* ---------- MITRE ATT&CK (Enterprise) – taktiky a běžné techniky ---------- */

export interface AttackTactic {
  id: string;
  name: string;
  cs: string;
}
/** Taktiky v pořadí matice ATT&CK Enterprise. */
export const ATTACK_TACTICS: AttackTactic[] = [
  { id: "TA0043", name: "Reconnaissance", cs: "Průzkum" },
  { id: "TA0042", name: "Resource Development", cs: "Příprava zdrojů" },
  { id: "TA0001", name: "Initial Access", cs: "Počáteční přístup" },
  { id: "TA0002", name: "Execution", cs: "Spuštění" },
  { id: "TA0003", name: "Persistence", cs: "Perzistence" },
  { id: "TA0004", name: "Privilege Escalation", cs: "Eskalace oprávnění" },
  { id: "TA0005", name: "Defense Evasion", cs: "Obcházení obrany" },
  { id: "TA0006", name: "Credential Access", cs: "Získání přihlašovacích údajů" },
  { id: "TA0007", name: "Discovery", cs: "Průzkum prostředí" },
  { id: "TA0008", name: "Lateral Movement", cs: "Laterální pohyb" },
  { id: "TA0009", name: "Collection", cs: "Sběr dat" },
  { id: "TA0011", name: "Command and Control", cs: "Řízení a kontrola (C2)" },
  { id: "TA0010", name: "Exfiltration", cs: "Exfiltrace" },
  { id: "TA0040", name: "Impact", cs: "Dopad" },
];

export interface AttackTechnique {
  id: string;
  name: string;
  tactics: string[];
}
export const ATTACK_TECHNIQUES: AttackTechnique[] = [
  { id: "T1595", name: "Active Scanning", tactics: ["TA0043"] },
  { id: "T1592", name: "Gather Victim Host Information", tactics: ["TA0043"] },
  { id: "T1583", name: "Acquire Infrastructure", tactics: ["TA0042"] },
  { id: "T1588", name: "Obtain Capabilities", tactics: ["TA0042"] },
  { id: "T1566", name: "Phishing", tactics: ["TA0001"] },
  { id: "T1190", name: "Exploit Public-Facing Application", tactics: ["TA0001"] },
  { id: "T1133", name: "External Remote Services", tactics: ["TA0001", "TA0003"] },
  { id: "T1078", name: "Valid Accounts", tactics: ["TA0001", "TA0003", "TA0004", "TA0005"] },
  { id: "T1189", name: "Drive-by Compromise", tactics: ["TA0001"] },
  { id: "T1195", name: "Supply Chain Compromise", tactics: ["TA0001"] },
  { id: "T1091", name: "Replication Through Removable Media", tactics: ["TA0001", "TA0008"] },
  { id: "T1059", name: "Command and Scripting Interpreter", tactics: ["TA0002"] },
  { id: "T1204", name: "User Execution", tactics: ["TA0002"] },
  { id: "T1053", name: "Scheduled Task/Job", tactics: ["TA0002", "TA0003", "TA0004"] },
  { id: "T1047", name: "Windows Management Instrumentation", tactics: ["TA0002"] },
  { id: "T1203", name: "Exploitation for Client Execution", tactics: ["TA0002"] },
  { id: "T1569", name: "System Services", tactics: ["TA0002"] },
  { id: "T1098", name: "Account Manipulation", tactics: ["TA0003", "TA0004"] },
  { id: "T1136", name: "Create Account", tactics: ["TA0003"] },
  { id: "T1543", name: "Create or Modify System Process", tactics: ["TA0003", "TA0004"] },
  { id: "T1547", name: "Boot or Logon Autostart Execution", tactics: ["TA0003", "TA0004"] },
  { id: "T1505", name: "Server Software Component", tactics: ["TA0003"] },
  { id: "T1068", name: "Exploitation for Privilege Escalation", tactics: ["TA0004"] },
  { id: "T1548", name: "Abuse Elevation Control Mechanism", tactics: ["TA0004", "TA0005"] },
  { id: "T1055", name: "Process Injection", tactics: ["TA0004", "TA0005"] },
  { id: "T1070", name: "Indicator Removal", tactics: ["TA0005"] },
  { id: "T1562", name: "Impair Defenses", tactics: ["TA0005"] },
  { id: "T1027", name: "Obfuscated Files or Information", tactics: ["TA0005"] },
  { id: "T1036", name: "Masquerading", tactics: ["TA0005"] },
  { id: "T1112", name: "Modify Registry", tactics: ["TA0005"] },
  { id: "T1222", name: "File and Directory Permissions Modification", tactics: ["TA0005"] },
  { id: "T1110", name: "Brute Force", tactics: ["TA0006"] },
  { id: "T1003", name: "OS Credential Dumping", tactics: ["TA0006"] },
  { id: "T1555", name: "Credentials from Password Stores", tactics: ["TA0006"] },
  { id: "T1552", name: "Unsecured Credentials", tactics: ["TA0006"] },
  { id: "T1556", name: "Modify Authentication Process", tactics: ["TA0006", "TA0005", "TA0003"] },
  { id: "T1087", name: "Account Discovery", tactics: ["TA0007"] },
  { id: "T1083", name: "File and Directory Discovery", tactics: ["TA0007"] },
  { id: "T1046", name: "Network Service Discovery", tactics: ["TA0007"] },
  { id: "T1082", name: "System Information Discovery", tactics: ["TA0007"] },
  { id: "T1018", name: "Remote System Discovery", tactics: ["TA0007"] },
  { id: "T1021", name: "Remote Services", tactics: ["TA0008"] },
  { id: "T1570", name: "Lateral Tool Transfer", tactics: ["TA0008"] },
  { id: "T1210", name: "Exploitation of Remote Services", tactics: ["TA0008"] },
  { id: "T1005", name: "Data from Local System", tactics: ["TA0009"] },
  { id: "T1114", name: "Email Collection", tactics: ["TA0009"] },
  { id: "T1560", name: "Archive Collected Data", tactics: ["TA0009"] },
  { id: "T1071", name: "Application Layer Protocol", tactics: ["TA0011"] },
  { id: "T1105", name: "Ingress Tool Transfer", tactics: ["TA0011"] },
  { id: "T1219", name: "Remote Access Software", tactics: ["TA0011"] },
  { id: "T1572", name: "Protocol Tunneling", tactics: ["TA0011"] },
  { id: "T1041", name: "Exfiltration Over C2 Channel", tactics: ["TA0010"] },
  { id: "T1048", name: "Exfiltration Over Alternative Protocol", tactics: ["TA0010"] },
  { id: "T1567", name: "Exfiltration Over Web Service", tactics: ["TA0010"] },
  { id: "T1486", name: "Data Encrypted for Impact", tactics: ["TA0040"] },
  { id: "T1485", name: "Data Destruction", tactics: ["TA0040"] },
  { id: "T1490", name: "Inhibit System Recovery", tactics: ["TA0040"] },
  { id: "T1489", name: "Service Stop", tactics: ["TA0040"] },
  { id: "T1498", name: "Network Denial of Service", tactics: ["TA0040"] },
  { id: "T1499", name: "Endpoint Denial of Service", tactics: ["TA0040"] },
  { id: "T1531", name: "Account Access Removal", tactics: ["TA0040"] },
  { id: "T1565", name: "Data Manipulation", tactics: ["TA0040"] },
  { id: "T1491", name: "Defacement", tactics: ["TA0040"] },
];

const TECH_BY_ID = new Map(ATTACK_TECHNIQUES.map((t) => [t.id, t]));
const TACTIC_BY_NAME = new Map(ATTACK_TACTICS.map((t) => [t.name.toLowerCase(), t.id]));

/** Platné ID techniky ATT&CK (T1234 nebo podtechnika T1234.001). */
export const ATTACK_ID_RE = /^T\d{4}(\.\d{3})?$/;

/** Technika z katalogu (podtechnika → nadřazená). */
export function attackTechnique(id: string): AttackTechnique | null {
  return TECH_BY_ID.get(id) ?? TECH_BY_ID.get(id.split(".")[0]!) ?? null;
}
export function attackTactic(id: string): AttackTactic | null {
  return ATTACK_TACTICS.find((t) => t.id === id) ?? null;
}
export const attackUrl = (id: string) => (id.startsWith("TA") ? `https://attack.mitre.org/tactics/${id}/` : `https://attack.mitre.org/techniques/${id.replace(".", "/")}/`);

/** Taktiky k technikám (z katalogu) + taktiky podle názvu z Wazuh (rule.mitre.tactic). */
export function tacticsFor(techniqueIds: string[], tacticNames: string[] = []): string[] {
  const out = new Set<string>();
  for (const id of techniqueIds) for (const ta of attackTechnique(id)?.tactics ?? []) out.add(ta);
  for (const n of tacticNames) {
    const id = TACTIC_BY_NAME.get(n.trim().toLowerCase());
    if (id) out.add(id);
  }
  return ATTACK_TACTICS.map((t) => t.id).filter((id) => out.has(id));
}

/** Technika podle skupin pravidla Wazuh, když alert nemá vlastní mapování (návrh – analytik upraví). */
export function techniquesFromGroups(groups: string[]): string[] {
  const g = groups.map((x) => x.toLowerCase());
  const has = (...k: string[]) => k.some((x) => g.some((y) => y.includes(x)));
  const out: string[] = [];
  if (has("authentication_failures", "authentication_failed", "brute", "invalid_login")) out.push("T1110");
  if (has("web", "sql_injection", "xss", "exploit_attempt")) out.push("T1190");
  if (has("dos", "flood")) out.push("T1499");
  if (has("virustotal", "malware", "rootcheck")) out.push("T1204");
  if (has("sudo", "privilege")) out.push("T1548");
  return out;
}

/* ---------- playbooky ---------- */

export interface SocPlaybook {
  key: string;
  name: { cs: string; en: string };
  /** Kdy se playbook navrhne: techniky (i podtechniky) nebo taktiky. */
  techniques: string[];
  tactics: string[];
  steps: { cs: string; en: string }[];
}

export const SOC_PLAYBOOKS: SocPlaybook[] = [
  {
    key: "brute_force",
    name: { cs: "Útok hádáním hesel", en: "Password brute force" },
    techniques: ["T1110"],
    tactics: [],
    steps: [
      { cs: "Ověřit zdrojové IP adresy a jejich reputaci; jde o interní, nebo externí zdroj?", en: "Check the source IP addresses and their reputation; internal or external source?" },
      { cs: "Zjistit, zda po neúspěšných pokusech následovalo úspěšné přihlášení (stejný účet / IP).", en: "Check whether failed attempts were followed by a successful logon (same account / IP)." },
      { cs: "Zablokovat zdrojové IP na firewallu nebo v fail2ban / Active Response.", en: "Block the source IPs on the firewall or via fail2ban / Active Response." },
      { cs: "U dotčených účtů vynutit změnu hesla a ověřit MFA.", en: "Force a password change for affected accounts and verify MFA." },
      { cs: "Omezit vystavení služby (SSH/RDP) do internetu – VPN, allow-list.", en: "Limit exposure of the service (SSH/RDP) to the internet – VPN, allow-list." },
      { cs: "Zaznamenat výsledek a rozhodnout o eskalaci na incident.", en: "Record the outcome and decide on escalation to an incident." },
    ],
  },
  {
    key: "phishing",
    name: { cs: "Phishing", en: "Phishing" },
    techniques: ["T1566", "T1204"],
    tactics: [],
    steps: [
      { cs: "Získat původní zprávu včetně hlaviček; ověřit odesílatele, odkazy a přílohy (sandbox).", en: "Obtain the original message with headers; check sender, links and attachments (sandbox)." },
      { cs: "Dohledat další příjemce stejné kampaně a zprávy odstranit ze schránek.", en: "Find other recipients of the same campaign and purge the messages from mailboxes." },
      { cs: "Zablokovat škodlivé domény a URL (proxy, DNS, e-mailová brána).", en: "Block the malicious domains and URLs (proxy, DNS, mail gateway)." },
      { cs: "Pokud uživatel klikl nebo zadal údaje: reset hesla, revokace relací, kontrola pravidel schránky.", en: "If a user clicked or entered credentials: reset the password, revoke sessions, check mailbox rules." },
      { cs: "Prověřit stanici uživatele (EDR / antivir), zda nebyl spuštěn škodlivý kód.", en: "Check the user's workstation (EDR / antivirus) for executed malicious code." },
      { cs: "Informovat uživatele a zvážit doplnění školení.", en: "Inform users and consider additional awareness training." },
    ],
  },
  {
    key: "malware",
    name: { cs: "Škodlivý kód", en: "Malware" },
    techniques: ["T1059", "T1105", "T1027", "T1036", "T1055", "T1547", "T1543"],
    tactics: ["TA0002"],
    steps: [
      { cs: "Izolovat dotčenou stanici / server od sítě (zachovat napájení kvůli forenzní analýze).", en: "Isolate the affected host from the network (keep it powered on for forensics)." },
      { cs: "Identifikovat soubor (hash), proces a způsob spuštění; ověřit v reputačních službách.", en: "Identify the file (hash), process and execution path; check reputation services." },
      { cs: "Vyhledat stejný indikátor (hash, doménu, IP) na ostatních aktivech.", en: "Search for the same indicator (hash, domain, IP) on other assets." },
      { cs: "Odstranit škodlivý kód nebo systém obnovit z čisté zálohy.", en: "Remove the malware or restore the system from a clean backup." },
      { cs: "Změnit přihlašovací údaje používané na dotčeném systému.", en: "Change credentials used on the affected system." },
      { cs: "Rozhodnout o eskalaci na incident a o hlášení (lhůty dle ZKB).", en: "Decide on escalation to an incident and on reporting (deadlines under the Cybersecurity Act)." },
    ],
  },
  {
    key: "ransomware",
    name: { cs: "Ransomware", en: "Ransomware" },
    techniques: ["T1486", "T1490", "T1485"],
    tactics: [],
    steps: [
      { cs: "Okamžitě izolovat dotčené systémy a zastavit šíření (síťové segmenty, sdílené disky).", en: "Immediately isolate affected systems and stop the spread (network segments, shared drives)." },
      { cs: "Eskalovat na incident a svolat krizový tým; zvážit hlášení NÚKIB / CSIRT.", en: "Escalate to an incident and convene the crisis team; consider reporting to the national CSIRT." },
      { cs: "Ověřit stav a integritu záloh (offline / neměnné kopie).", en: "Verify the state and integrity of backups (offline / immutable copies)." },
      { cs: "Zajistit důkazy (vzorky, logy, poznámka o výkupném) před obnovou.", en: "Preserve evidence (samples, logs, ransom note) before recovery." },
      { cs: "Zjistit vstupní vektor a uzavřít ho (zranitelnost, účet, vzdálený přístup).", en: "Identify the entry vector and close it (vulnerability, account, remote access)." },
      { cs: "Obnovit systémy podle plánu obnovy a priorit BIA.", en: "Restore systems according to the recovery plan and BIA priorities." },
    ],
  },
  {
    key: "web_attack",
    name: { cs: "Útok na webovou aplikaci", en: "Web application attack" },
    techniques: ["T1190", "T1505"],
    tactics: [],
    steps: [
      { cs: "Z logů ověřit, zda požadavky uspěly (kódy odpovědí, velikost, následné požadavky).", en: "Check the logs whether the requests succeeded (status codes, sizes, follow-up requests)." },
      { cs: "Porovnat s evidovanými zranitelnostmi aplikace / serveru (CVE v CONTIXu).", en: "Compare with known vulnerabilities of the application / server (CVEs in CONTIX)." },
      { cs: "Zablokovat zdroj (WAF, firewall) a případně nasadit dočasné pravidlo WAF.", en: "Block the source (WAF, firewall) and deploy a temporary WAF rule if needed." },
      { cs: "Zkontrolovat webový adresář na nové / změněné soubory (web shell).", en: "Check the web root for new / modified files (web shell)." },
      { cs: "Aplikovat opravu nebo kompenzační opatření a ověřit.", en: "Apply the patch or a compensating control and verify." },
    ],
  },
  {
    key: "privilege_escalation",
    name: { cs: "Eskalace oprávnění / zneužití účtu", en: "Privilege escalation / account misuse" },
    techniques: ["T1068", "T1548", "T1078", "T1098", "T1136", "T1003"],
    tactics: ["TA0004", "TA0006"],
    steps: [
      { cs: "Ověřit u vlastníka účtu / správce, zda šlo o plánovanou činnost.", en: "Confirm with the account owner / administrator whether the activity was planned." },
      { cs: "Zkontrolovat změny členství v privilegovaných skupinách a nově vytvořené účty.", en: "Check changes to privileged group membership and newly created accounts." },
      { cs: "Při podezření účet zablokovat, změnit heslo a revokovat relace a tokeny.", en: "If suspicious, disable the account, change the password and revoke sessions and tokens." },
      { cs: "Prohledat další systémy, kde byl účet použit (laterální pohyb).", en: "Search other systems where the account was used (lateral movement)." },
      { cs: "Vyhodnotit nálezy v modulu Identity a přístupy.", en: "Review findings in the Identity & access module." },
    ],
  },
  {
    key: "exfiltration",
    name: { cs: "Únik dat", en: "Data exfiltration" },
    techniques: ["T1041", "T1048", "T1567", "T1560", "T1114"],
    tactics: ["TA0010", "TA0009"],
    steps: [
      { cs: "Určit objem, cíl a čas přenosu dat (proxy, firewall, NetFlow).", en: "Determine the volume, destination and time of the transfer (proxy, firewall, NetFlow)." },
      { cs: "Zablokovat cílovou adresu / službu a zastavit přenos.", en: "Block the destination / service and stop the transfer." },
      { cs: "Zjistit, jaká data unikla, a zda jde o osobní údaje (GDPR – 72 h na ohlášení).", en: "Determine which data leaked and whether personal data is involved (GDPR – 72 h to notify)." },
      { cs: "Eskalovat na incident; zapojit pověřence pro ochranu osobních údajů.", en: "Escalate to an incident; involve the data protection officer." },
    ],
  },
  {
    key: "dos",
    name: { cs: "Odepření služby (DoS)", en: "Denial of service" },
    techniques: ["T1498", "T1499"],
    tactics: [],
    steps: [
      { cs: "Ověřit dostupnost dotčených služeb a dopad na uživatele.", en: "Check availability of affected services and user impact." },
      { cs: "Identifikovat zdroje a charakter provozu; kontaktovat poskytovatele konektivity / anti-DDoS.", en: "Identify traffic sources and pattern; contact the ISP / anti-DDoS provider." },
      { cs: "Nasadit filtrování, rate-limiting nebo geo-blokaci.", en: "Apply filtering, rate limiting or geo-blocking." },
      { cs: "Vyhodnotit dopad na regulovanou službu a lhůty hlášení.", en: "Assess the impact on the regulated service and reporting deadlines." },
    ],
  },
  {
    key: "generic",
    name: { cs: "Obecná triáž alertu", en: "Generic alert triage" },
    techniques: [],
    tactics: [],
    steps: [
      { cs: "Ověřit, zda alert odpovídá skutečné aktivitě (logy, kontext aktiva, čas).", en: "Verify that the alert reflects real activity (logs, asset context, time)." },
      { cs: "Zkontrolovat historii stejného pravidla a podobné záznamy.", en: "Check the history of the same rule and similar records." },
      { cs: "Určit dotčená aktiva a jejich kritičnost.", en: "Identify affected assets and their criticality." },
      { cs: "Rozhodnout: uzavřít (falešný poplach / neškodné), nebo eskalovat na incident.", en: "Decide: close (false positive / benign) or escalate to an incident." },
    ],
  },
];

/** Navržený playbook podle technik a taktik alertu (první shoda, jinak obecný). */
export function playbookFor(techniqueIds: string[], tacticIds: string[]): SocPlaybook {
  const base = techniqueIds.map((t) => t.split(".")[0]!);
  for (const p of SOC_PLAYBOOKS) if (p.techniques.some((t) => base.includes(t))) return p;
  for (const p of SOC_PLAYBOOKS) if (p.tactics.some((t) => tacticIds.includes(t))) return p;
  return SOC_PLAYBOOKS.find((p) => p.key === "generic")!;
}
export const playbookByKey = (key: string | null | undefined) => SOC_PLAYBOOKS.find((p) => p.key === key) ?? null;

/* ---------- vstupy a DTO ---------- */

const attackIds = z.array(z.string().trim().toUpperCase().regex(ATTACK_ID_RE, "Neplatné ID techniky ATT&CK")).max(20);

export const SocAlertCreate = z.object({
  title: z.string().trim().min(3).max(300),
  description: z.string().trim().max(5000).default(""),
  severity: z.enum(SOC_SEVERITIES).default("medium"),
  mitreIds: attackIds.default([]),
  assetId: z.string().uuid().nullable().optional(),
  detectedAt: z.string().datetime({ offset: true }).optional(),
  companyId: z.string().uuid().optional(),
});
export type SocAlertCreate = z.input<typeof SocAlertCreate>;

export const SocAlertPatch = z.object({
  assigneeId: z.string().uuid().nullable().optional(),
  status: z.enum(SOC_OPEN_STATUSES).optional(),
  mitreIds: attackIds.optional(),
  playbookKey: z.string().max(40).nullable().optional(),
  playbookDone: z.array(z.number().int().min(0).max(99)).max(50).optional(),
});
export type SocAlertPatch = z.input<typeof SocAlertPatch>;

export const SocNoteInput = z.object({ text: z.string().trim().min(1).max(4000) });
export const SocCloseInput = z.object({
  verdict: z.enum(SOC_VERDICTS),
  reason: z.string().trim().min(1).max(1000),
  /** Zároveň potlačit stejné alerty (pravidlo + hostitel) do data (v0.52). */
  suppressUntil: z.string().date().optional(),
  /** Potlačení jen pro zdrojovou IP z alertu. */
  suppressIp: z.boolean().optional(),
});
export const SocEscalateInput = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  kind: z.enum(["unassessed", "event", "incident"]).default("unassessed"),
  /** Připojit k existujícímu incidentu místo založení nového. */
  incidentId: z.string().uuid().optional(),
});
export const SocAdvisorInput = z.object({ question: z.string().trim().min(3).max(2000), alertId: z.string().uuid().optional() });

export interface SocNote {
  at: string;
  userId: string | null;
  userName: string | null;
  text: string;
}
export interface SocAdvice {
  text: string;
  model: string | null;
  at: string;
  durationMs: number;
}

export interface SocAlertDto extends AlertSuggestionDto {
  title: string;
  /** Závažnost včetně zvýšení za zranitelné aktivum (`effectiveLevel`). */
  severity: SocSeverity;
  exposure: SocExposure | null;
  /** AI předběžná triáž (ADR-051). */
  aiTriage: SocAiTriage | null;
  /** Shody s veřejnými zdroji IOC (ADR-057). */
  intel: TiMatch[] | null;
  source: string;
  assigneeId: string | null;
  assigneeName: string | null;
  verdict: SocVerdict | null;
  mitreIds: string[];
  mitreTactics: string[];
  playbookKey: string | null;
  acknowledgedAt: string | null;
  decidedAt: string | null;
  incidentTitle: string | null;
  caseId: string | null;
  caseCode: string | null;
  /** Lhůty (jen alerty mimo případ; u alertu v případu platí lhůty případu). */
  sla: SocSla | null;
}
/** Riziko z registru navázané na aktivum alertu / případu (jen při risks:read). */
export interface SocLinkedRisk {
  id: string;
  name: string;
  level: string | null;
  assetName: string;
}

/* ---------- AI předběžná triáž (v0.56, ADR-051) ---------- */

export const SOC_CONFIDENCE = ["low", "medium", "high"] as const;
export type SocConfidence = (typeof SOC_CONFIDENCE)[number];
export type SocSimilarReason = "same_rule" | "same_host" | "same_ip" | "technique";

/** Dřívější rozhodnutý alert podobný tomuto (pravidlo, hostitel, IP, techniky ATT&CK). */
export interface SocSimilarAlert {
  id: string;
  title: string;
  status: string;
  verdict: SocVerdict | null;
  lastSeen: string;
  reasons: SocSimilarReason[];
}

/** Návrh AI – nikdy se neaplikuje sám; analytik ho použije nebo ignoruje. */
export interface SocAiTriage {
  verdict: SocVerdict | null;
  /** Doporučený postup: eskalovat (skutečný útok), uzavřít (falešný / neškodný), prověřit (nelze určit). */
  action: "escalate" | "close" | "investigate" | null;
  severity: SocSeverity | null;
  confidence: SocConfidence | null;
  reasoning: string;
  similar: SocSimilarAlert[];
  model: string | null;
  at: string;
  durationMs: number;
  error: string | null;
}

/** Postup podle navrženého verdiktu. */
export const triageAction = (v: SocVerdict | null): SocAiTriage["action"] => (v === "true_positive" ? "escalate" : v === "false_positive" || v === "benign" ? "close" : v === "undetermined" ? "investigate" : null);

export interface SocAlertDetailDto extends SocAlertDto {
  playbookDone: number[];
  /** Použitý playbook (vestavěný nebo vlastní playbook společnosti, ADR-060). */
  playbook: import("./socPlaybooks").SocPlaybookView;
  /** Úkoly týmu z kroků playbooku. */
  playbookTasks: import("./socPlaybooks").SocPlaybookTask[];
  risks: SocLinkedRisk[];
  notes: SocNote[];
  aiAdvice: SocAdvice | null;
  /** Historie stejného pravidla na stejném agentovi: počty podle verdiktu. */
  history: { total: number; byVerdict: Partial<Record<SocVerdict, number>>; escalated: number };
  /** Otevřené zranitelnosti aktiva (nejzávažnější). */
  assetVulns: { cveId: string; severity: string; cvss: number | null }[];
  canWrite: boolean;
  canEscalate: boolean;
}

export interface SocSummaryDto {
  open: number;
  new: number;
  inProgress: number;
  unassigned: number;
  mine: number;
  bySeverity: Record<SocSeverity, number>;
  /** Posledních 30 dní. */
  escalated30: number;
  closed30: Partial<Record<SocVerdict, number>>;
  /** Medián doby do převzetí (h) za 30 dní; null = bez dat. */
  mttaHours: number | null;
  /** Počet alertů podle taktiky ATT&CK za 30 dní. */
  tactics30: Record<string, number>;
  lastSyncAt: string | null;
  syncEnabled: boolean;
  /** Otevřené alerty a případy po lhůtě převzetí nebo vyřešení. */
  slaBreached: number;
  openCases: number;
}

export interface SocAnalyst {
  id: string;
  displayName: string;
}

export interface SocAdvisorAnswer {
  answer: string;
  model: string | null;
  durationMs: number;
}


/* ============================================================
 * v0.52 (ADR-047): případy (korelace alertů), lhůty SLA, potlačení falešných poplachů, statistika pravidel.
 * ============================================================ */

/* ---------- lhůty ---------- */

export interface SocSettings {
  /** Lhůta převzetí (minuty) podle závažnosti. */
  ackMinutes: Record<SocSeverity, number>;
  /** Lhůta vyřešení (hodiny) podle závažnosti. */
  resolveHours: Record<SocSeverity, number>;
  /** Automatické spojování alertů do případů (stejný hostitel / zdrojová IP). */
  autoCases: boolean;
  /** Časové okno korelace (hodiny). */
  correlationHours: number;
  /** AI předběžná triáž nových alertů na lokálním modelu (ADR-051). */
  aiTriage: boolean;
}
export const SOC_SETTINGS_DEFAULTS: SocSettings = {
  ackMinutes: { critical: 15, high: 60, medium: 240, low: 1440 },
  resolveHours: { critical: 4, high: 24, medium: 72, low: 168 },
  autoCases: true,
  correlationHours: 24,
  aiTriage: true,
};
const bySev = (min: number, max: number) => z.object({ critical: z.number().int().min(min).max(max), high: z.number().int().min(min).max(max), medium: z.number().int().min(min).max(max), low: z.number().int().min(min).max(max) });
export const SocSettingsInput = z.object({
  ackMinutes: bySev(1, 10080).optional(),
  resolveHours: bySev(1, 2160).optional(),
  autoCases: z.boolean().optional(),
  correlationHours: z.number().int().min(1).max(168).optional(),
  aiTriage: z.boolean().optional(),
});
export type SocSettingsInput = z.input<typeof SocSettingsInput>;

/** met = splněno včas, late = splněno po lhůtě, ok = běží, soon = zbývá < 25 % lhůty, breached = po lhůtě. */
export type SlaState = "met" | "late" | "ok" | "soon" | "breached";
export interface SocSla {
  ackDue: string;
  resolveDue: string;
  ack: SlaState;
  resolve: SlaState;
}

function slaOf(start: Date, due: Date, doneAt: Date | null, now: Date): SlaState {
  if (doneAt) return doneAt <= due ? "met" : "late";
  if (now > due) return "breached";
  return (due.getTime() - now.getTime()) / Math.max(1, due.getTime() - start.getTime()) < 0.25 ? "soon" : "ok";
}

/** Lhůty převzetí a vyřešení od vzniku alertu / případu (počítá se při čtení, nepersistuje). */
export function socSla(severity: SocSeverity, createdAt: Date, acknowledgedAt: Date | null, closedAt: Date | null, settings: SocSettings, now = new Date()): SocSla {
  const ackDue = new Date(createdAt.getTime() + settings.ackMinutes[severity] * 60_000);
  const resolveDue = new Date(createdAt.getTime() + settings.resolveHours[severity] * 3600_000);
  return { ackDue: ackDue.toISOString(), resolveDue: resolveDue.toISOString(), ack: slaOf(createdAt, ackDue, acknowledgedAt ?? closedAt, now), resolve: slaOf(createdAt, resolveDue, closedAt, now) };
}
/** Nejhorší stav lhůt (pro řazení a zvýraznění). */
export function slaWorst(s: SocSla | null): SlaState | null {
  if (!s) return null;
  const order: SlaState[] = ["breached", "soon", "late", "ok", "met"];
  return order.find((x) => s.ack === x || s.resolve === x) ?? null;
}

/* ---------- případy ---------- */

export const SOC_CASE_STATUSES = ["open", "in_progress", "escalated", "closed"] as const;
export type SocCaseStatus = (typeof SOC_CASE_STATUSES)[number];
export const SOC_CASE_OPEN = ["open", "in_progress"] as const;

export type SocChainReason = "credential_then_access" | "impact" | "multi_tactic";
const SEV_ORDER: SocSeverity[] = ["low", "medium", "high", "critical"];

/**
 * Závažnost případu: nejvyšší závažnost alertů, o stupeň výš, když alerty tvoří řetězec útoku. Každý alert přispívá
 * svou hlavní (nejranější) taktikou – technika jako T1078 spadá do více taktik, ale sama řetězec netvoří.
 * Řetězec: získání přihlašovacích údajů + přístup / eskalace / laterální pohyb / exfiltrace / dopad; dopad nebo exfiltrace
 * s další taktikou; tři a více různých hlavních taktik.
 */
export function caseSeverity(alertSeverities: SocSeverity[], alertTactics: string[][]): { severity: SocSeverity; base: SocSeverity; chain: SocChainReason | null } {
  const base = SEV_ORDER[Math.max(0, ...alertSeverities.map((s) => SEV_ORDER.indexOf(s)))]!;
  const order = ATTACK_TACTICS.map((x) => x.id);
  const primary = (ts: string[]) => ts.filter((x) => order.includes(x)).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
  const t = new Set(alertTactics.map(primary).filter((x): x is string => !!x));
  const after = ["TA0001", "TA0004", "TA0008", "TA0010", "TA0040"];
  let chain: SocChainReason | null = null;
  if (t.has("TA0006") && after.some((x) => t.has(x))) chain = "credential_then_access";
  else if ((t.has("TA0040") || t.has("TA0010")) && t.size >= 2) chain = "impact";
  else if (t.size >= 3) chain = "multi_tactic";
  const severity = chain ? SEV_ORDER[Math.min(3, SEV_ORDER.indexOf(base) + 1)]! : base;
  return { severity, base, chain };
}

export const SocCaseCreate = z.object({
  title: z.string().trim().min(3).max(300),
  description: z.string().trim().max(5000).default(""),
  alertIds: z.array(z.string().uuid()).min(1).max(200),
});
export type SocCaseCreate = z.input<typeof SocCaseCreate>;
export const SocCasePatch = z.object({
  title: z.string().trim().min(3).max(300).optional(),
  description: z.string().trim().max(5000).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  status: z.enum(SOC_CASE_OPEN).optional(),
});
export type SocCasePatch = z.input<typeof SocCasePatch>;
export const SocCaseAlertsInput = z.object({ add: z.array(z.string().uuid()).max(200).default([]), remove: z.array(z.string().uuid()).max(200).default([]) });
export const SocCaseCloseInput = z.object({ verdict: z.enum(SOC_VERDICTS), reason: z.string().trim().min(1).max(1000) });

export interface SocCaseDto {
  id: string;
  code: string;
  companyId: string;
  title: string;
  description: string;
  status: SocCaseStatus;
  severity: SocSeverity;
  baseSeverity: SocSeverity;
  chain: SocChainReason | null;
  auto: boolean;
  assigneeId: string | null;
  assigneeName: string | null;
  alertCount: number;
  openAlerts: number;
  mitreIds: string[];
  mitreTactics: string[];
  hosts: string[];
  srcips: string[];
  firstSeen: string | null;
  lastSeen: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  closedAt: string | null;
  verdict: SocVerdict | null;
  closeReason: string | null;
  incidentId: string | null;
  incidentTitle: string | null;
  sla: SocSla;
}
/** Signály SOC k riziku: alerty na aktivech rizika za období (ADR-048). */
export interface SocRiskSignals {
  days: number;
  alerts: number;
  open: number;
  truePositive: number;
  escalated: number;
  falsePositive: number;
  exploitAttempts: number;
  tactics: Record<string, number>;
  lastSeen: string | null;
  /** Doporučit přehodnocení pravděpodobnosti (skutečné útoky nebo pokusy o zneužití). */
  reassess: boolean;
  recent: SocAlertDto[];
}

export interface SocCaseDetailDto extends SocCaseDto {
  alerts: SocAlertDto[];
  risks: SocLinkedRisk[];
  notes: SocNote[];
  canWrite: boolean;
  canEscalate: boolean;
}

/* ---------- potlačení ---------- */

const IP_RE = /^[0-9a-fA-F:.]{2,45}(\/\d{1,3})?$/;
export const SocSuppressionInput = z.object({
  ruleId: z.string().trim().min(1).max(50),
  agentId: z.string().trim().max(50).nullable().optional(),
  srcip: z.string().trim().regex(IP_RE, "Neplatná IP adresa").nullable().optional(),
  reason: z.string().trim().min(3).max(1000),
  until: z.string().date(),
  companyId: z.string().uuid().optional(),
});
export type SocSuppressionInput = z.input<typeof SocSuppressionInput>;
/** Nejdelší platnost potlačení (dny). */
export const SOC_SUPPRESSION_MAX_DAYS = 366;

export type SocSuppressionState = "active" | "expired" | "revoked";
export interface SocSuppressionDto {
  id: string;
  companyId: string;
  ruleId: string;
  ruleDescription: string | null;
  agentId: string | null;
  agentName: string | null;
  srcip: string | null;
  reason: string;
  until: string;
  state: SocSuppressionState;
  hits: number;
  lastHitAt: string | null;
  createdByName: string | null;
  createdAt: string;
  revokedAt: string | null;
}

/** Odpovídá skupina alertů pravidlu potlačení? (pravidlo povinné, hostitel a IP volitelné) */
export function suppressionMatches(s: { ruleId: string; agentId: string | null; srcip: string | null }, a: { ruleId: string; agentId: string | null; srcip: string | null }): boolean {
  if (s.ruleId !== a.ruleId) return false;
  if (s.agentId && s.agentId !== a.agentId) return false;
  if (s.srcip && s.srcip !== a.srcip) return false;
  return true;
}

/* ---------- statistika pravidel ---------- */

export type SocRuleAdvice = "tune" | "review" | "keep";
export interface SocRuleStat {
  ruleId: string;
  description: string;
  level: number;
  alerts: number;
  events: number;
  open: number;
  escalated: number;
  decided: number;
  truePositive: number;
  falsePositive: number;
  benign: number;
  /** Podíl falešných poplachů a neškodné aktivity z rozhodnutých (0–1); null = málo dat. */
  fpRate: number | null;
  suppressedHits: number;
  activeSuppressions: number;
  lastSeen: string;
  advice: SocRuleAdvice | null;
}

/** Doporučení k pravidlu: ladit (≥ 80 % falešných z ≥ 3 rozhodnutých), prověřit (≥ 50 %), ponechat (eskalace). */
export function ruleAdvice(r: Pick<SocRuleStat, "decided" | "fpRate" | "escalated">): SocRuleAdvice | null {
  if (r.decided >= 3 && r.fpRate != null && r.fpRate >= 0.8) return "tune";
  if (r.decided >= 2 && r.fpRate != null && r.fpRate >= 0.5) return "review";
  if (r.escalated > 0) return "keep";
  return null;
}

export const SOC_LABELS = {
  status: { new: "Nový", in_progress: "V řešení", accepted: "Eskalováno", dismissed: "Uzavřeno" } as Record<string, string>,
  severity: { low: "Nízká", medium: "Střední", high: "Vysoká", critical: "Kritická" } as Record<SocSeverity, string>,
  verdict: { true_positive: "Skutečný útok", false_positive: "Falešný poplach", benign: "Neškodná aktivita", undetermined: "Nelze určit" } as Record<SocVerdict, string>,
  source: { wazuh: "Wazuh", manual: "Ruční", webhook: "Webhook", suricata: "Suricata", defender: "Microsoft Defender", phishing: "Hlášení phishingu", threatintel: "Zdroje hrozeb", hunt: "Hledání hrozeb", netscan: "Síťový sken", sentinel: "Microsoft Sentinel", elastic: "Elastic Security" } as Record<string, string>,
  caseStatus: { open: "Otevřený", in_progress: "V řešení", escalated: "Eskalováno", closed: "Uzavřeno" } as Record<SocCaseStatus, string>,
  sla: { met: "Splněno včas", late: "Splněno po lhůtě", ok: "Běží", soon: "Brzy vyprší", breached: "Po lhůtě" } as Record<SlaState, string>,
  chain: { credential_then_access: "Řetězec útoku: přihlašovací údaje a následný přístup", impact: "Řetězec útoku končící dopadem nebo exfiltrací", multi_tactic: "Alerty ze tří a více fází útoku (taktik ATT&CK)" } as Record<SocChainReason, string>,
  suppression: { active: "Platné", expired: "Po platnosti", revoked: "Zrušené" } as Record<SocSuppressionState, string>,
  advice: { tune: "Doladit pravidlo", review: "Prověřit", keep: "Užitečné" } as Record<SocRuleAdvice, string>,
  confidence: { low: "Nízká jistota", medium: "Střední jistota", high: "Vysoká jistota" } as Record<SocConfidence, string>,
  action: { escalate: "Eskalovat na incident", close: "Uzavřít", investigate: "Prověřit" } as Record<NonNullable<SocAiTriage["action"]>, string>,
  similarReason: { same_rule: "stejné pravidlo", same_host: "stejný hostitel", same_ip: "stejná IP", technique: "stejná technika" } as Record<SocSimilarReason, string>,
  exposure: { cve_match: "Útok na známou zranitelnost aktiva", exploit_technique: "Pokus o zneužití na zranitelném aktivu", vulnerable_asset: "Aktivum má vysoké / kritické zranitelnosti" } as Record<SocExposure["reason"], string>,
};
