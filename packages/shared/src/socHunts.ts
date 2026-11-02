import { z } from "zod";
import { patchOf } from "./zutil";
import { ATTACK_ID_RE, SOC_SEVERITIES, type SocSeverity } from "./soc";

/* ============================================================
 * Plánované hledání hrozeb (v0.64, ADR-059): uložené dotazy (Lucene / query_string) do alertů
 * Wazuh Indexeru, spouštěné v intervalu nad novým oknem. Seskupení podle pole (agent, zdrojová IP…),
 * shoda nad prahem → alert SOC `source = hunt`. Jen čtení z indexeru, nic se neodesílá ven.
 * ============================================================ */

/** Pole pro seskupení výsledků (výchozí nabídka; lze zadat i vlastní pole). */
export const SOC_HUNT_GROUP_FIELDS = ["agent.id", "data.srcip", "data.dstip", "data.srcuser", "data.dstuser", "data.win.eventdata.targetUserName", "rule.id"] as const;
const FIELD_RE = /^[a-zA-Z0-9_.@-]{1,100}$/;

export const SOC_HUNT_MAX_BUCKETS = 50;

export interface SocHuntBucket {
  key: string;
  count: number;
  agentId: string | null;
  agentName: string | null;
  first: string | null;
  last: string | null;
}
export interface SocHuntRun {
  at: string;
  since: string;
  until: string;
  /** Počet nalezených záznamů v okně. */
  total: number;
  /** Skupiny nad prahem. */
  buckets: SocHuntBucket[];
  alerts: number;
  error: string | null;
  /** Zkušební běh – alerty se nezakládají a okno se neposouvá. */
  dryRun: boolean;
}

export interface SocHuntDto {
  id: string;
  companyId: string;
  name: string;
  hypothesis: string;
  query: string;
  groupBy: string;
  threshold: number;
  intervalHours: number;
  lookbackHours: number;
  severity: SocSeverity;
  mitreIds: string[];
  enabled: boolean;
  templateKey: string | null;
  lastRun: SocHuntRun | null;
  /** Kdy proběhne další běh (zapnuté hledání). */
  nextRunAt: string | null;
  /** Otevřené alerty z tohoto hledání. */
  openAlerts: number;
  createdByName: string | null;
  updatedAt: string;
}

export const SocHuntInput = z.object({
  name: z.string().trim().min(3).max(200),
  hypothesis: z.string().trim().max(2000).default(""),
  query: z.string().trim().min(3).max(4000),
  groupBy: z.string().trim().regex(FIELD_RE, "Neplatný název pole").default("agent.id"),
  threshold: z.number().int().min(1).max(100_000).default(1),
  intervalHours: z.number().int().min(1).max(168).default(24),
  lookbackHours: z.number().int().min(1).max(720).default(24),
  severity: z.enum(SOC_SEVERITIES).default("medium"),
  mitreIds: z.array(z.string().trim().regex(ATTACK_ID_RE)).max(10).default([]),
  enabled: z.boolean().default(true),
  templateKey: z.string().trim().max(40).nullable().optional(),
  companyId: z.string().uuid().optional(),
});
export type SocHuntInput = z.input<typeof SocHuntInput>;
export const SocHuntPatch = patchOf(SocHuntInput.omit({ companyId: true }));
export type SocHuntPatch = z.input<typeof SocHuntPatch>;

/** Kdy se má hledání spustit znovu (null = vypnuto; zkušební běhy se neukládají). */
export function huntNextRun(h: { enabled: boolean; intervalHours: number; lastRun: Pick<SocHuntRun, "at"> | null }): string | null {
  if (!h.enabled) return null;
  if (!h.lastRun) return new Date(0).toISOString();
  return new Date(new Date(h.lastRun.at).getTime() + h.intervalHours * 3600_000).toISOString();
}

export interface SocHuntTemplate {
  key: string;
  name: string;
  hypothesis: string;
  query: string;
  groupBy: string;
  threshold: number;
  intervalHours: number;
  severity: SocSeverity;
  mitreIds: string[];
}

/** Knihovna hledání pro alerty Wazuhu (Linux, Windows přes Sysmon / Security log). */
export const SOC_HUNT_TEMPLATES: SocHuntTemplate[] = [
  {
    key: "brute_force_source",
    name: "Hádání hesel z jedné adresy",
    hypothesis: "Útočník zkouší hesla z jedné IP adresy na více účtů nebo služeb.",
    query: "rule.groups:(authentication_failed OR authentication_failures)",
    groupBy: "data.srcip",
    threshold: 20,
    intervalHours: 1,
    severity: "medium",
    mitreIds: ["T1110"],
  },
  {
    key: "log_clearing",
    name: "Mazání bezpečnostních protokolů",
    hypothesis: "Útočník maže stopy – vymazání protokolu zabezpečení nebo systémového protokolu.",
    query: "rule.groups:log_clearing OR data.win.system.eventID:(1102 OR 104)",
    groupBy: "agent.id",
    threshold: 1,
    intervalHours: 1,
    severity: "high",
    mitreIds: ["T1070.001"],
  },
  {
    key: "encoded_powershell",
    name: "PowerShell s kódovaným příkazem",
    hypothesis: "Škodlivý kód se spouští přes PowerShell s parametrem -EncodedCommand nebo dekódováním Base64.",
    query: "data.win.eventdata.commandLine:(*-enc* OR *EncodedCommand* OR *FromBase64String*)",
    groupBy: "agent.id",
    threshold: 1,
    intervalHours: 1,
    severity: "high",
    mitreIds: ["T1059.001", "T1027"],
  },
  {
    key: "credential_dumping",
    name: "Výpis přihlašovacích údajů z paměti",
    hypothesis: "Nástroje typu Mimikatz nebo výpis paměti procesu LSASS.",
    query: "data.win.eventdata.commandLine:(*mimikatz* OR *sekurlsa* OR *lsass*) OR data.win.eventdata.targetImage:*lsass.exe",
    groupBy: "agent.id",
    threshold: 1,
    intervalHours: 1,
    severity: "critical",
    mitreIds: ["T1003.001"],
  },
  {
    key: "persistence_tasks_services",
    name: "Nové plánované úlohy a služby",
    hypothesis: "Útočník si zajišťuje přetrvání novou plánovanou úlohou nebo službou.",
    query: "data.win.system.eventID:(4698 OR 7045)",
    groupBy: "agent.id",
    threshold: 1,
    intervalHours: 24,
    severity: "medium",
    mitreIds: ["T1053.005", "T1543.003"],
  },
  {
    key: "new_admin_accounts",
    name: "Nové účty a členství v administrátorských skupinách",
    hypothesis: "Útočník zakládá účty nebo je přidává do privilegovaných skupin.",
    query: "rule.groups:(adduser OR group_changed) OR data.win.system.eventID:(4720 OR 4728 OR 4732 OR 4756)",
    groupBy: "agent.id",
    threshold: 1,
    intervalHours: 24,
    severity: "medium",
    mitreIds: ["T1136", "T1098"],
  },
  {
    key: "critical_files_changed",
    name: "Změna kritických systémových souborů",
    hypothesis: "Změna souborů s účty, oprávněními nebo překladem jmen (passwd, shadow, sudoers, hosts).",
    query: "rule.groups:syscheck AND syscheck.path:(*passwd* OR *shadow* OR *sudoers* OR *hosts*)",
    groupBy: "agent.id",
    threshold: 1,
    intervalHours: 24,
    severity: "high",
    mitreIds: ["T1098", "T1565.001"],
  },
];

export const SOC_HUNT_LABELS = {
  groupBy: {
    "agent.id": "Agent (hostitel)",
    "data.srcip": "Zdrojová IP",
    "data.dstip": "Cílová IP",
    "data.srcuser": "Zdrojový uživatel",
    "data.dstuser": "Cílový uživatel",
    "data.win.eventdata.targetUserName": "Cílový účet (Windows)",
    "rule.id": "Pravidlo",
  } as Record<string, string>,
};
