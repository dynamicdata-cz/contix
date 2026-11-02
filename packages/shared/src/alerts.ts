import { z } from "zod";
import type { IncidentCategory } from "./incidents";

/* ============================================================
 * Návrhy bezpečnostních událostí z Wazuh alertů (§ 14 odst. 1 – detekce a evidence událostí).
 * Alerty nad prahem úrovně se seskupí podle pravidla a agenta; člověk návrh přijme (vznikne událost) nebo zamítne.
 * ============================================================ */

/** in_progress (v0.51) = převzato analytikem SOC; accepted = eskalováno na incident; dismissed = uzavřeno. */
export const ALERT_SUGGESTION_STATUSES = ["new", "in_progress", "accepted", "dismissed"] as const;
export type AlertSuggestionStatus = (typeof ALERT_SUGGESTION_STATUSES)[number];

export const AlertSettingsInput = z.object({
  alertsEnabled: z.boolean(),
  /** Minimální úroveň pravidla Wazuh (0–15); 10+ = vysoká závažnost. */
  alertMinLevel: z.number().int().min(1).max(15).default(10),
  alertsIndexPattern: z
    .string()
    .trim()
    .regex(/^[a-z0-9*._-]{1,100}$/, "Neplatný vzor indexu")
    .default("wazuh-alerts-*"),
});
export type AlertSettingsInput = z.input<typeof AlertSettingsInput>;

export const DismissSuggestionInput = z.object({ reason: z.string().trim().min(1).max(1000) });
export const AcceptSuggestionInput = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  kind: z.enum(["unassessed", "event", "incident"]).default("unassessed"),
});

export interface AlertSuggestionDto {
  id: string;
  companyId: string;
  ruleId: string;
  ruleLevel: number;
  description: string;
  groups: string[];
  agentId: string | null;
  agentName: string | null;
  assetId: string | null;
  assetName: string | null;
  firstSeen: string;
  lastSeen: string;
  count: number;
  status: AlertSuggestionStatus;
  incidentId: string | null;
  dismissReason: string | null;
  sample: Record<string, unknown> | null;
}

/** Kategorie incidentu podle skupin pravidla Wazuh (návrh – člověk upraví). */
export function categoryFromGroups(groups: string[]): IncidentCategory {
  const g = groups.map((x) => x.toLowerCase());
  const has = (...k: string[]) => k.some((x) => g.some((y) => y.includes(x)));
  if (has("malware", "rootcheck", "virus", "virustotal")) return "malware";
  if (has("authentication_failures", "brute", "invalid_login", "authentication_failed")) return "unauthorized_access";
  if (has("web", "attack", "sql_injection", "xss", "exploit")) return "vulnerability_exploit";
  if (has("syscheck", "integrity", "policy_changed", "config")) return "misconfiguration";
  if (has("dos", "flood")) return "dos";
  return "other";
}
