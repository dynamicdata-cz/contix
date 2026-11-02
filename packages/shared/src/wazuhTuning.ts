import { z } from "zod";
import { patchOf } from "./zutil";

/* ============================================================
 * Ladění pravidel Wazuh – návrhy (v1.14, ADR-111).
 * Návrh = výjimka (child pravidlo s level 0) nebo změna úrovně pro konkrétní pravidlo, vždy jako strukturovaná
 * data → XML se generuje deterministicky (escapování, pcre2), nikdy se nepřebírá text od modelu ani od uživatele.
 * Ověření = simulace nad událostmi ve Wazuh Indexeru (kolik událostí by zmizelo a zda by se skryly události
 * z alertů označených jako skutečný útok nebo eskalovaných). Do Wazuhu CONTIX v této fázi nic nezapisuje –
 * schválené návrhy se exportují jako local_rules.xml.
 * ============================================================ */

export const TUNING_KINDS = ["exclude", "level"] as const;
export type TuningKind = (typeof TUNING_KINDS)[number];
export const TUNING_STATUSES = ["draft", "approved", "rejected"] as const;
export type TuningStatus = (typeof TUNING_STATUSES)[number];
export const TUNING_CONDITION_KINDS = ["srcip", "dstip", "user", "program_name", "hostname", "location", "field"] as const;
export type TuningConditionKind = (typeof TUNING_CONDITION_KINDS)[number];
/** Čísla vlastních pravidel CONTIXu v rozsahu lokálních pravidel Wazuh (100000–120000). */
export const TUNING_RULE_ID_BASE = 109000;
export const TUNING_RULE_ID_MAX = 119999;

const IP_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\/(?:3[0-2]|[12]?\d))?$|^[0-9a-fA-F:]{2,39}(?:\/\d{1,3})?$/;
const FIELD_RE = /^[A-Za-z0-9_@-]+(?:\.[A-Za-z0-9_@-]+){0,8}$/;

export const TuningCondition = z
  .object({
    kind: z.enum(TUNING_CONDITION_KINDS),
    /** Jen u `field`: název dekódovaného pole bez předpony `data.` (např. win.eventdata.image). */
    field: z.string().trim().max(120).optional().nullable(),
    op: z.enum(["equals", "regex"]).default("equals"),
    value: z.string().trim().min(1).max(300),
  })
  .superRefine((c, ctx) => {
    if (c.kind === "field" && (!c.field || !FIELD_RE.test(c.field))) ctx.addIssue({ code: "custom", path: ["field"], message: "Název pole: písmena, číslice, _ @ - a tečky" });
    if ((c.kind === "srcip" || c.kind === "dstip") && (c.op !== "equals" || !IP_RE.test(c.value))) ctx.addIssue({ code: "custom", path: ["value"], message: "IP adresa nebo rozsah CIDR" });
    if (c.op === "regex")
      try {
        new RegExp(c.value);
      } catch {
        ctx.addIssue({ code: "custom", path: ["value"], message: "Neplatný regulární výraz" });
      }
    if (/[\u0000-\u001f]/.test(c.value)) ctx.addIssue({ code: "custom", path: ["value"], message: "Řídicí znaky nejsou povoleny" });
  });
export type TuningCondition = z.infer<typeof TuningCondition>;

export const TuningProposalBase = z.object({
    companyId: z.string().uuid().optional(),
    ruleId: z.string().trim().regex(/^\d{1,9}$/, "Číslo pravidla Wazuh"),
    kind: z.enum(TUNING_KINDS),
    conditions: z.array(TuningCondition).max(5).default([]),
    /** Nová úroveň (jen `level`, 0–15). */
    newLevel: z.number().int().min(0).max(15).nullable().optional(),
    rationale: z.string().trim().max(3000).default(""),
});
export const TuningProposalInput = TuningProposalBase.superRefine((p, ctx) => {
    if (p.kind === "exclude" && !p.conditions.length) ctx.addIssue({ code: "custom", path: ["conditions"], message: "Výjimka musí mít aspoň jednu podmínku – jinak by vypnula celé pravidlo" });
    if (p.kind === "level" && p.newLevel == null) ctx.addIssue({ code: "custom", path: ["newLevel"], message: "Zadejte novou úroveň" });
  });
export type TuningProposalInput = z.input<typeof TuningProposalInput>;
export const TuningProposalPatch = patchOf(TuningProposalBase.omit({ companyId: true, ruleId: true }));
export type TuningProposalPatch = z.input<typeof TuningProposalPatch>;

export const TuningDecisionInput = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(2000).nullable().optional() });

/** Cesta pole v události Wazuh Indexeru (pro simulaci a hledání návrhů). */
export function tuningIndexPath(c: Pick<TuningCondition, "kind" | "field">): string {
  switch (c.kind) {
    case "srcip":
      return "data.srcip";
    case "dstip":
      return "data.dstip";
    case "user":
      return "data.srcuser";
    case "program_name":
      return "predecoder.program_name";
    case "hostname":
      return "predecoder.hostname";
    case "location":
      return "location";
    case "field":
      return `data.${c.field}`;
  }
}

/** Pole události → podmínka návrhu (opak `tuningIndexPath`); null = pole nelze v pravidle Wazuh použít. */
export function conditionForPath(path: string, value: string): TuningCondition | null {
  const fixed: Record<string, TuningConditionKind> = { "data.srcip": "srcip", "data.dstip": "dstip", "data.srcuser": "user", "predecoder.program_name": "program_name", "predecoder.hostname": "hostname", location: "location" };
  if (fixed[path]) return { kind: fixed[path]!, field: null, op: "equals", value };
  if (path.startsWith("data.") && FIELD_RE.test(path.slice(5))) return { kind: "field", field: path.slice(5), op: "equals", value };
  return null;
}

export const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Doslovná hodnota jako pcre2 (ukotvená). */
export const pcreLiteral = (s: string) => `^${s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`;

function conditionXml(c: TuningCondition): string {
  if (c.kind === "srcip" || c.kind === "dstip") return `<${c.kind}>${xmlEsc(c.value)}</${c.kind}>`;
  const re = xmlEsc(c.op === "equals" ? pcreLiteral(c.value) : c.value);
  if (c.kind === "field") return `<field name="${xmlEsc(c.field ?? "")}" type="pcre2">${re}</field>`;
  return `<${c.kind} type="pcre2">${re}</${c.kind}>`;
}

/** XML jednoho pravidla (child pravidlo `if_sid`) – vstup jsou jen validovaná strukturovaná data. */
export function tuningRuleXml(p: { wazuhRuleId: number; ruleId: string; kind: TuningKind; conditions: TuningCondition[]; newLevel?: number | null; description: string; ref: string }): string {
  const level = p.kind === "exclude" ? 0 : (p.newLevel ?? 0);
  const desc = `CONTIX ${p.ref}: ${p.kind === "exclude" ? "výjimka z pravidla" : `úroveň ${level} pro pravidlo`} ${p.ruleId} – ${p.description}`.slice(0, 250);
  return [
    `  <rule id="${p.wazuhRuleId}" level="${level}">`,
    `    <if_sid>${xmlEsc(p.ruleId)}</if_sid>`,
    ...p.conditions.map((c) => `    ${conditionXml(c)}`),
    `    <description>${xmlEsc(desc)}</description>`,
    `  </rule>`,
  ].join("\n");
}

/** Soubor pravidel pro ruční nasazení (manager: /var/ossec/etc/rules/contix_tuning.xml). */
export function tuningRulesFile(rules: string[], generatedAt: string): string {
  return [`<!-- CONTIX – schválené úpravy pravidel (${generatedAt}). Ověřte na manageru: /var/ossec/bin/wazuh-logtest -->`, `<group name="contix_tuning,">`, ...rules, `</group>`, ""].join("\n");
}

/** Shoda podmínek s hodnotami události (simulace bez indexeru nad vzorkem alertu). */
export function conditionsMatch(conditions: TuningCondition[], get: (path: string) => string | null | undefined): boolean | null {
  for (const c of conditions) {
    const v = get(tuningIndexPath(c));
    if (v == null) return null;
    if (c.op === "equals" ? v !== c.value : !new RegExp(c.value).test(v)) return false;
  }
  return true;
}

export interface TuningSimulation {
  at: string;
  days: number;
  /** indexer = události ve Wazuh Indexeru, contix = jen vzorky alertů v CONTIXu (omezené pole). */
  source: "indexer" | "contix";
  total: number;
  matched: number;
  /** Alerty označené jako skutečný útok nebo eskalované, jejichž události by úprava skryla. */
  protectedAlerts: { id: string; title: string; verdict: string | null; status: string }[];
  note: string | null;
}

export interface TuningProposalDto {
  id: string;
  companyId: string;
  ref: string;
  wazuhRuleId: number;
  ruleId: string;
  ruleDescription: string;
  kind: TuningKind;
  conditions: TuningCondition[];
  newLevel: number | null;
  rationale: string;
  source: "manual" | "auto";
  status: TuningStatus;
  simulation: TuningSimulation | null;
  xml: string;
  createdByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  canDecide: boolean;
  createdAt: string;
}

export const TUNING_LABELS = {
  kind: { exclude: "Výjimka (potlačit odpovídající události)", level: "Změna úrovně závažnosti" } satisfies Record<TuningKind, string>,
  status: { draft: "Návrh", approved: "Schváleno", rejected: "Zamítnuto" } satisfies Record<TuningStatus, string>,
  condition: {
    srcip: "Zdrojová IP",
    dstip: "Cílová IP",
    user: "Uživatel",
    program_name: "Program",
    hostname: "Hostitel (syslog)",
    location: "Umístění (zdroj logu)",
    field: "Pole události",
  } satisfies Record<TuningConditionKind, string>,
} as const;
