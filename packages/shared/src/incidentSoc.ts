import type { TimelineEntry } from "./incidents";
import type { SocIocAction, SocIocState, SocIocType } from "./socIoc";
import type { SocActionKind, SocActionStatus } from "./socResponse";
import type { SocSeverity, SocVerdict } from "./soc";

/* ============================================================
 * Incident × SOC (v0.61, ADR-056): podklady ze SOC k incidentu (alerty, případy, IOC, zásahy), návrh doplnění
 * polí záznamu (jen návrh – převezme a uloží člověk) a záznam o zvládání incidentu (§ 14 vyhl. 409/2025).
 * ============================================================ */

export interface IncidentSocAlert {
  id: string;
  title: string;
  source: string;
  ruleId: string;
  severity: SocSeverity;
  count: number;
  firstSeen: string;
  lastSeen: string;
  agentName: string | null;
  assetId: string | null;
  assetName: string | null;
  verdict: SocVerdict | null;
  mitreIds: string[];
  caseCode: string | null;
}
export interface IncidentSocIoc {
  id: string;
  type: SocIocType;
  value: string;
  display: string;
  action: SocIocAction;
  state: SocIocState;
}
export interface IncidentSocAction {
  id: string;
  kind: SocActionKind;
  target: string;
  status: SocActionStatus;
  reason: string;
  requestedByName: string | null;
  createdAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  executedByName: string | null;
  executedAt: string | null;
  result: string | null;
}
export interface IncidentSocEvidence {
  /** Případy SOC navázané na incident (v1.05). */
  cases: { id: string; code: string; title: string; status: string }[];
  alerts: IncidentSocAlert[];
  iocs: IncidentSocIoc[];
  actions: IncidentSocAction[];
  techniques: string[];
  firstSeen: string | null;
  lastSeen: string | null;
}

/** Návrh doplnění záznamu incidentu ze SOC – pole jsou celé nové texty (stávající + doplněné řádky), null = beze změny. */
export interface IncidentSocDraft {
  occurredAt: string | null;
  indicators: string | null;
  evidence: string | null;
  containment: string | null;
  timeline: TimelineEntry[];
  /** Aktiva z alertů, která u incidentu ještě nejsou. */
  assets: { id: string; name: string }[];
}

/** Připojí řádky, které v textu ještě nejsou (porovnání podle obsahu řádku); null = nic nového. */
export function appendLines(current: string | null | undefined, heading: string, lines: string[]): string | null {
  const cur = (current ?? "").trim();
  const fresh = lines.filter((l) => l.trim() && !cur.includes(l.replace(/^- /, "").trim()));
  if (!fresh.length) return null;
  const head = cur.includes(heading) ? "" : `${heading}\n`;
  return `${cur ? `${cur}\n\n` : ""}${head}${fresh.join("\n")}`.slice(0, 20000);
}

/** Nové položky časové osy (bez duplicit podle času a textu), seřazené. */
export function mergeTimeline(current: TimelineEntry[], add: TimelineEntry[]): TimelineEntry[] {
  const key = (e: TimelineEntry) => `${new Date(e.at).toISOString().slice(0, 16)}|${e.text}`;
  const have = new Set(current.map(key));
  const seen = new Set<string>();
  return add
    .filter((e) => {
      const k = key(e);
      if (have.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.at.localeCompare(b.at));
}
