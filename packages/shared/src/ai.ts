import { z } from "zod";
import { isIpOrCidr } from "./aiQuery";
import { FrameworkIdSchema } from "./frameworks";

/* ============================================================
 * AI asistent – rozhraní na poskytovatele modelu (lokální Ollama / Open WebUI / OpenAI-kompatibilní API).
 * Výstupy jsou vždy NÁVRHY: ukládají se do `ai_suggestions`, člověk je přijme (celé / po položkách) nebo zamítne.
 * Do modelu se posílají jen nutná pole (žádná jména osob, e-maily, přihlašovací údaje).
 * ============================================================ */

export const AI_PROVIDERS = ["openai", "ollama"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: "OpenAI-kompatibilní API (Open WebUI, vLLM, LM Studio…)",
  ollama: "Ollama (nativní API /api/chat)",
};

/** Předvolby adres – lokální instalace na stejném serveru jako CONTIX. */
export const AI_PRESETS: { key: string; label: string; provider: AiProvider; baseUrl: string; hint: string }[] = [
  { key: "openwebui", label: "Open WebUI (OpenAI API)", provider: "openai", baseUrl: "http://127.0.0.1:8080/api", hint: "API klíč: Open WebUI → Nastavení → Účet → API klíče" },
  { key: "openwebui-ollama", label: "Open WebUI → Ollama proxy", provider: "ollama", baseUrl: "http://127.0.0.1:8080/ollama", hint: "API klíč z Open WebUI; přímý přístup k modelům Ollamy" },
  { key: "ollama", label: "Ollama (port 11434)", provider: "ollama", baseUrl: "http://127.0.0.1:11434", hint: "Bez klíče; port musí být publikován" },
];

export const AI_USE_CASES = ["risk_treatment", "control_mapping", "asset_classification", "finding_remediation", "incident_summary", "policy_review", "legal_change", "ai_act_screening", "vex_triage", "incident_triage", "vuln_scan_triage", "supplier_report_extract", "questionnaire_answer"] as const;
export type AiUseCase = (typeof AI_USE_CASES)[number];
export const AI_USE_CASE_LABELS: Record<AiUseCase, string> = {
  risk_treatment: "Návrh opatření pro zvládání rizika",
  control_mapping: "Návrh mapování opatření na požadavky",
  asset_classification: "Návrh klasifikace aktiva (kritičnost, CIA)",
  finding_remediation: "Návrh nápravných opatření ke zjištění",
  incident_summary: "Shrnutí incidentu a poučení",
  policy_review: "Skóre dokumentu vůči požadavkům a náměty ke zlepšení",
  legal_change: "Shrnutí změny předpisu a návrh úkolů",
  ai_act_screening: "Návrh screeningu a klasifikace AI systému (AI Act)",
  vex_triage: "Návrh prohlášení VEX ke zranitelnostem komponent",
  incident_triage: "Triáž incidentu podle podobných případů",
  vuln_scan_triage: "Triáž nálezů ze skenu (duplicity, falešně pozitivní)",
  supplier_report_extract: "Vytěžení zprávy dodavatele (CUEC, výjimky, subdodavatelé)",
  questionnaire_answer: "Návrh odpovědí na bezpečnostní dotazník zákazníka",
};
/** Typ záznamu, ke kterému úloha patří. */
export const AI_USE_CASE_ENTITY: Record<AiUseCase, "risk" | "control" | "asset" | "finding" | "incident" | "policy" | "legal_review" | "ai_system" | "cra_product" | "vuln_scan" | "supplier_report" | "customer_questionnaire"> = {
  risk_treatment: "risk",
  control_mapping: "control",
  asset_classification: "asset",
  finding_remediation: "finding",
  incident_summary: "incident",
  policy_review: "policy",
  legal_change: "legal_review",
  ai_act_screening: "ai_system",
  vex_triage: "cra_product",
  incident_triage: "incident",
  vuln_scan_triage: "vuln_scan",
  supplier_report_extract: "supplier_report",
  questionnaire_answer: "customer_questionnaire",
};
/** Modul, který musí být zapnutý. */
export const AI_USE_CASE_MODULE: Record<AiUseCase, string> = {
  risk_treatment: "risks",
  control_mapping: "controls",
  asset_classification: "assets",
  finding_remediation: "audits",
  incident_summary: "incidents",
  policy_review: "policies",
  legal_change: "legislation",
  ai_act_screening: "aiact",
  vex_triage: "cra",
  incident_triage: "incidents",
  vuln_scan_triage: "vulnerabilities",
  supplier_report_extract: "suppliers",
  questionnaire_answer: "trust",
};

/** Pole aktiva, která smí AI navrhnout. */
export const AI_ASSET_FIELDS = ["criticality", "confidentiality", "integrity", "availability"] as const;
export type AiAssetField = (typeof AI_ASSET_FIELDS)[number];
/** Pole incidentu, která smí AI vyplnit. */
export const AI_INCIDENT_FIELDS = ["impactDescription", "rootCause", "lessonsLearned"] as const;
export type AiIncidentField = (typeof AI_INCIDENT_FIELDS)[number];
export const AI_FIELD_LABELS: Record<AiAssetField | AiIncidentField | "summary", string> = {
  criticality: "Kritičnost",
  confidentiality: "Důvěrnost",
  integrity: "Integrita",
  availability: "Dostupnost",
  impactDescription: "Popis dopadu",
  rootCause: "Příčina",
  lessonsLearned: "Poučení a doporučení",
  summary: "Shrnutí pro vedení",
};

export const AI_SUGGESTION_STATUSES = ["running", "proposed", "accepted", "partially_accepted", "rejected", "failed"] as const;
export type AiSuggestionStatus = (typeof AI_SUGGESTION_STATUSES)[number];
export const AI_STATUS_LABELS: Record<AiSuggestionStatus, string> = {
  running: "Zpracovává se",
  proposed: "Navrženo",
  accepted: "Přijato",
  partially_accepted: "Přijato částečně",
  rejected: "Zamítnuto",
  failed: "Chyba",
};

export const AiSettingsInput = z.object({
  enabled: z.boolean().optional(),
  provider: z.enum(AI_PROVIDERS).optional(),
  baseUrl: z.string().trim().url().max(500).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  /** API klíč – ukládá se šifrovaně, nevrací se. Prázdný řetězec = smazat. */
  apiKey: z.string().max(1000).optional(),
  /** Časový limit jednoho dotazu (lokální modely s uvažováním potřebují víc času). */
  timeoutSec: z.number().int().min(10).max(900).optional(),
  temperature: z.number().min(0).max(1.5).optional(),
  /** Doplňující pokyny pro všechny dotazy (např. „odpovídej stručně“, terminologie organizace). */
  instructions: z.string().trim().max(2000).nullable().optional(),
  /** MCP server (/api/mcp) pro externí AI klienty s osobním API tokenem. */
  mcpEnabled: z.boolean().optional(),
  /** IP adresy / rozsahy CIDR, ze kterých smí MCP klient volat (např. server s Open WebUI). Povinné pro zapnutí MCP. */
  mcpAllowedIps: z
    .array(z.string().trim().refine(isIpOrCidr, "Neplatná IP adresa nebo rozsah CIDR"))
    .max(20)
    .optional(),
  /** „Zeptej se dokumentace“ – odpovědi z platných dokumentů (v0.27). */
  docQaEnabled: z.boolean().optional(),
  recordSearchEnabled: z.boolean().optional(),
  /** Model pro vektorové vyhledávání (embedding), např. bge-m3. */
  embeddingModel: z.string().trim().min(1).max(200).optional(),
});
export type AiSettingsInput = z.input<typeof AiSettingsInput>;

export interface AiSettingsDto {
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKeySet: boolean;
  timeoutSec: number;
  temperature: number;
  instructions: string | null;
  mcpEnabled: boolean;
  mcpAllowedIps: string[];
  docQaEnabled: boolean;
  recordSearchEnabled: boolean;
  embeddingModel: string;
  lastTestAt: string | null;
  lastTestResult: string | null;
}

/** Stav AI pro běžné uživatele (bez konfigurace). */
export interface AiStatusDto {
  enabled: boolean;
  /** MCP server zapnutý (osobní API tokeny). */
  mcpEnabled: boolean;
  model: string | null;
  useCases: AiUseCase[];
  /** Zeptej se dokumentace je zapnuté. */
  docQa: boolean;
  /** Vektory záznamů (rizika, zranitelnosti, incidenty, výjimky) jsou zapnuté. */
  recordSearch: boolean;
}

export const AiRequestInput = z.object({
  useCase: z.enum(AI_USE_CASES),
  entityId: z.string().uuid(),
  /** Pro mapování: cílový rámec (výchozí podle režimu společnosti). */
  framework: FrameworkIdSchema.optional(),
  /** Volitelné upřesnění od uživatele (např. „preferujeme technická opatření“). */
  note: z.string().trim().max(1000).optional(),
});
export type AiRequestInput = z.input<typeof AiRequestInput>;

export const AiDecisionInput = z.object({
  /** Indexy přijatých položek; prázdné pole = zamítnout. */
  accept: z.array(z.number().int().min(0)).max(500),
  note: z.string().trim().max(2000).optional(),
  /** Vzít na vědomí (skóre dokumentu bez námětů nebo bez založení připomínek) – nejde o zamítnutí. */
  acknowledge: z.boolean().optional(),
});
export type AiDecisionInput = z.input<typeof AiDecisionInput>;

/** Indexy položek, o kterých má smysl rozhodovat (u skóre dokumentu jen náměty – „pokryto“ je jen informace). */
export function actionableItems(items: { kind?: string; status?: string }[]): number[] {
  return items.map((it, i) => (it.kind === "gap" && it.status === "covered" ? -1 : i)).filter((i) => i >= 0);
}

/* ---------------- výstupy jednotlivých úloh ---------------- */

export const TreatmentItemSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(3000).default(""),
  objective: z.string().trim().max(1000).default(""),
  /** organizational | technical | physical | people */
  category: z.string().trim().max(40).default(""),
  /** Čísla § vyhlášky (409 / 410 podle režimu společnosti), ke kterým opatření patří. */
  paragraphs: z.array(z.union([z.string().max(10), z.number()]).transform((v) => String(v).replace(/[^0-9]/g, ""))).max(6).default([]),
});
export type TreatmentItem = z.infer<typeof TreatmentItemSchema>;

export const MappingItemSchema = z.object({
  requirementId: z.string().trim().min(1).max(60),
  reason: z.string().trim().max(1000).default(""),
});
export type MappingItem = z.infer<typeof MappingItemSchema>;

/** Návrh hodnoty pole (aktivum: kritičnost, CIA). */
export interface FieldItem {
  field: AiAssetField;
  value: string | number;
  current: string | number | null;
  reason: string;
}
/** Návrh textu pole (incident) nebo samostatného textu (shrnutí). */
export interface TextItem {
  field: AiIncidentField | "summary";
  text: string;
  /** Pole už má hodnotu – přijetím se text připojí. */
  hasValue: boolean;
}
export const GAP_STATUSES = ["covered", "partial", "missing"] as const;
export type GapStatus = (typeof GAP_STATUSES)[number];
export const GAP_LABELS: Record<GapStatus, string> = { covered: "Pokryto", partial: "Částečně", missing: "Chybí" };
/** Pokrytí požadavku dokumentem. */
export interface GapItem {
  requirementId: string;
  ref: string;
  text: string;
  status: GapStatus;
  reason: string;
  /** Námět ke zlepšení dokumentu (u partial / missing). */
  suggestion?: string;
}
/** Úkol navržený ke změně předpisu. */
export interface LegalTaskItem {
  title: string;
  description: string;
  policyId: string | null;
  policyLabel: string | null;
  requirementId: string | null;
  requirementRef: string | null;
}

/** Nastavení pole záznamu (screening AI Act, triáž incidentu) – hodnota je validovaná proti výčtům. */
export interface SetItem {
  field: string;
  value: string | boolean | string[] | null;
  current: string | boolean | string[] | null;
  reason: string;
}
/** Návrh prohlášení VEX k nálezu (ověřené ID nálezu z kontextu). */
export interface VexItem {
  findingId: string;
  vulnId: string;
  componentRef: string;
  status: string;
  justification: string | null;
  impactStatement: string | null;
  actionStatement: string | null;
  reason: string;
}

/** Návrh triáže nálezu ze skenu (ADR-095) – ID nálezů ověřená proti kontextu. */
export interface VulnTriageItem {
  findingId: string;
  action: "duplicate" | "false_positive" | "verify";
  duplicateOfId: string | null;
  title: string;
  duplicateTitle: string | null;
  reason: string;
}

/** Položka vytěžená ze zprávy dodavatele (ADR-098): CUEC s návrhem vlastního opatření, výjimka, kontrola subdodavatele. */
export interface ReportExtractItem {
  itemKind: "cuec" | "exception" | "csoc";
  ref: string | null;
  text: string;
  criterion: string | null;
  controlId: string | null;
  controlName: string | null;
  severity: "low" | "medium" | "high" | null;
  managementResponse: string | null;
  reason: string;
}

/** Návrh odpovědi na otázku dotazníku zákazníka (ADR-099) – zdroje jen z nabídky pro danou otázku. */
export interface QaAnswerItem {
  itemId: string;
  question: string;
  answer: "yes" | "no" | "partial" | "na" | null;
  answerText: string | null;
  sources: { kind: "library" | "policy" | "control" | "certification"; id: string; label: string }[];
  confidence: "low" | "medium" | "high";
  reason: string;
}

export type AiItem =
  | ({ kind: "qa_answer" } & QaAnswerItem)
  | ({ kind: "report_item" } & ReportExtractItem)
  | ({ kind: "vuln_triage" } & VulnTriageItem)
  | ({ kind: "set" } & SetItem)
  | ({ kind: "vex" } & VexItem)
  | ({ kind: "treatment" } & TreatmentItem)
  | ({ kind: "mapping"; ref: string; text: string } & MappingItem)
  | ({ kind: "field" } & FieldItem)
  | ({ kind: "text" } & TextItem)
  | ({ kind: "gap" } & GapItem)
  | ({ kind: "legal_task" } & LegalTaskItem);

const CRIT = ["low", "medium", "high", "critical"] as const;

/** Validace návrhu klasifikace aktiva – jen povolená pole a hodnoty, jen změny oproti současnosti. */
export function parseAssetFields(raw: unknown, current: Record<AiAssetField, string | number | null>): { summary: string | null; items: FieldItem[] } {
  const out: FieldItem[] = [];
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(src.fields) ? src.fields : AI_ASSET_FIELDS.map((f) => (f in src ? { field: f, value: src[f], reason: src[`${f}Reason`] } : null)).filter(Boolean);
  for (const x of list as { field?: unknown; value?: unknown; reason?: unknown }[]) {
    const field = String(x?.field ?? "") as AiAssetField;
    if (!(AI_ASSET_FIELDS as readonly string[]).includes(field) || out.some((o) => o.field === field)) continue;
    let value: string | number | null = null;
    if (field === "criticality") {
      const v = String(x.value ?? "").toLowerCase();
      value = (CRIT as readonly string[]).includes(v) ? v : null;
    } else {
      const n = Number(x.value);
      value = Number.isInteger(n) && n >= 1 && n <= 4 ? n : null;
    }
    if (value == null || value === current[field]) continue;
    out.push({ field, value, current: current[field], reason: String(x.reason ?? "").slice(0, 1000) });
  }
  return { summary: summaryOf(raw), items: out };
}

/** Validace textových návrhů (incident) – jen povolená pole, neprázdný text. */
export function parseTextFields(raw: unknown, allowed: readonly string[], hasValue: (f: string) => boolean): { summary: string | null; items: TextItem[] } {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const items: TextItem[] = [];
  for (const f of allowed) {
    const v = src[f];
    if (typeof v !== "string" || !v.trim()) continue;
    items.push({ field: f as TextItem["field"], text: v.trim().slice(0, 5000), hasValue: f === "summary" ? false : hasValue(f) });
  }
  return { summary: summaryOf(raw), items };
}

/** Validace kontroly dokumentu – jen požadavky z nabídky, každý jednou. */
export function parseGaps(raw: unknown, known: Map<string, { ref: string; text: string }>): { summary: string | null; items: GapItem[] } {
  const seen = new Set<string>();
  const items: GapItem[] = [];
  for (const x of asList(raw, "requirements").slice(0, 80) as { requirementId?: unknown; status?: unknown; reason?: unknown }[]) {
    const id = normalizeReqId(String(x?.requirementId ?? ""));
    const st = String(x?.status ?? "").toLowerCase() as GapStatus;
    const req = known.get(id);
    if (!req || seen.has(id) || !(GAP_STATUSES as readonly string[]).includes(st)) continue;
    seen.add(id);
    const sug = String((x as { suggestion?: unknown }).suggestion ?? "").trim().slice(0, 1500);
    items.push({ requirementId: id, ref: req.ref, text: req.text, status: st, reason: String(x.reason ?? "").slice(0, 1000), ...(sug && st !== "covered" ? { suggestion: sug } : {}) });
  }
  const order = { missing: 0, partial: 1, covered: 2 } as const;
  return { summary: summaryOf(raw), items: items.sort((a, b) => order[a.status] - order[b.status]) };
}

/** Skóre pokrytí požadavků dokumentem (0–100): pokryto 1, částečně 0,5, chybí 0. */
export function gapScore(items: { status: GapStatus }[]): number | null {
  if (!items.length) return null;
  const pts = items.reduce((s, i) => s + (i.status === "covered" ? 1 : i.status === "partial" ? 0.5 : 0), 0);
  return Math.round((pts / items.length) * 100);
}

/** Validace návrhu úkolů ke změně předpisu – jen známé dokumenty a požadavky. */
export function parseLegalTasks(
  raw: unknown,
  docs: Map<string, string>,
  req: (id: string) => { ref: string } | null,
): { summary: string | null; items: LegalTaskItem[] } {
  const items: LegalTaskItem[] = [];
  for (const x of asList(raw, "tasks").slice(0, 15) as Record<string, unknown>[]) {
    const title = String(x?.title ?? "").trim().slice(0, 300);
    if (!title) continue;
    const pid = typeof x.policyId === "string" && docs.has(x.policyId) ? x.policyId : null;
    const rid = typeof x.requirementId === "string" ? normalizeReqId(x.requirementId) : "";
    const r = rid ? req(rid) : null;
    items.push({ title, description: String(x.description ?? "").trim().slice(0, 3000), policyId: pid, policyLabel: pid ? docs.get(pid)! : null, requirementId: r ? rid : null, requirementRef: r?.ref ?? null });
  }
  return { summary: summaryOf(raw), items };
}

export interface AiSuggestionDto {
  id: string;
  companyId: string;
  useCase: AiUseCase;
  entityType: string;
  entityId: string;
  status: AiSuggestionStatus;
  provider: string;
  model: string;
  summary: string | null;
  items: AiItem[];
  acceptedItems: number[];
  error: string | null;
  durationMs: number | null;
  createdByName: string | null;
  createdAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

/** Položka auditního přehledu AI (administrace). */
export interface AiLogRow extends AiSuggestionDto {
  /** Odeslaný kontext (minimalizovaný) – pro audit. */
  input: unknown;
  rawOutput: string | null;
  entityName: string | null;
}

/**
 * Vytáhne JSON objekt z odpovědi modelu – toleruje ```json bloky, úvodní text a „thinking“ značky.
 * Vrací null, pokud nic rozumného nenajde.
 */
export function extractJson(text: string): unknown {
  if (!text) return null;
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<details type="reasoning"[\s\S]*?<\/details>/g, "")
    .trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fence?.[1], cleaned];
  for (const c of candidates) {
    if (!c) continue;
    try {
      return JSON.parse(c);
    } catch {
      /* zkusit vyříznout */
    }
    const start = c.search(/[[{]/);
    if (start < 0) continue;
    const open = c[start]!;
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inStr = false;
    for (let i = start; i < c.length; i++) {
      const ch = c[i]!;
      if (inStr) {
        if (ch === "\\") i++;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close && --depth === 0) {
        try {
          return JSON.parse(c.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }
  return null;
}

const asList = (v: unknown, key: string): unknown[] => {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o[key])) return o[key] as unknown[];
    const arr = Object.values(o).find(Array.isArray);
    if (arr) return arr as unknown[];
  }
  return [];
};
const summaryOf = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) && typeof (v as { summary?: unknown }).summary === "string" ? ((v as { summary: string }).summary.slice(0, 2000) || null) : null);

/** Validace výstupu „opatření pro riziko“; ponechají se jen známá čísla §. */
export function parseTreatment(raw: unknown, knownParagraph: (par: string) => boolean): { summary: string | null; items: TreatmentItem[] } {
  const items: TreatmentItem[] = [];
  for (const x of asList(raw, "measures").slice(0, 10)) {
    const p = TreatmentItemSchema.safeParse(x);
    if (!p.success) continue;
    items.push({ ...p.data, paragraphs: [...new Set(p.data.paragraphs.filter(knownParagraph))] });
  }
  return { summary: summaryOf(raw), items };
}

/** Validace výstupu „mapování na požadavky“ – neznámá ID a duplicity se zahodí. */
export function parseMapping(raw: unknown, knownRequirement: (id: string) => boolean, exclude: Set<string>): { summary: string | null; items: MappingItem[] } {
  const seen = new Set<string>();
  const items: MappingItem[] = [];
  for (const x of asList(raw, "requirements").slice(0, 40)) {
    const p = MappingItemSchema.safeParse(x);
    if (!p.success) continue;
    const id = normalizeReqId(p.data.requirementId);
    if (!knownRequirement(id) || exclude.has(id) || seen.has(id)) continue;
    seen.add(id);
    items.push({ ...p.data, requirementId: id });
  }
  return { summary: summaryOf(raw), items: items.slice(0, 20) };
}

/** Modely občas vrátí „cz409:§ 8/1/f“ nebo „soc2:cc6.1“ – sjednotí na stabilní ID. */
export function normalizeReqId(id: string): string {
  const t = id.trim().replace(/\s+/g, "");
  const [fw, rest] = t.includes(":") ? [t.slice(0, t.indexOf(":")).toLowerCase(), t.slice(t.indexOf(":") + 1)] : ["", t];
  const r = rest.replace(/^§/, "");
  if (fw === "soc2") return `soc2:${r.toUpperCase()}`;
  if (fw === "nis2") return `nis2:${r.replace(/^p(?=\d)/i, "P")}`;
  return fw ? `${fw}:${r}` : r;
}

/* ---------------- v0.99: screening AI Act, VEX triáž, triáž incidentu ---------------- */

type FieldSpec = { type: "bool" } | { type: "enum"; values: readonly string[]; nullable?: boolean } | { type: "list"; values: readonly string[] };
const same = (a: unknown, b: unknown) => JSON.stringify(Array.isArray(a) ? [...a].sort() : a) === JSON.stringify(Array.isArray(b) ? [...b].sort() : b);

/** Validace návrhu nastavení polí: jen známá pole a hodnoty z výčtů, jen změny oproti současnosti. */
export function parseSetFields(raw: unknown, spec: Record<string, FieldSpec>, current: Record<string, SetItem["value"]>, objectKey: string): { summary: string | null; items: SetItem[] } {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const vals = (src[objectKey] && typeof src[objectKey] === "object" ? src[objectKey] : src) as Record<string, unknown>;
  const reasons = (src.reasons && typeof src.reasons === "object" ? src.reasons : {}) as Record<string, unknown>;
  const items: SetItem[] = [];
  for (const [field, sp] of Object.entries(spec)) {
    if (!(field in vals)) continue;
    const v = vals[field];
    let value: SetItem["value"] | undefined;
    if (sp.type === "bool") value = typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : undefined;
    else if (sp.type === "enum") value = v === null || v === "" || v === "null" ? (sp.nullable ? null : undefined) : typeof v === "string" && sp.values.includes(v) ? v : undefined;
    else if (Array.isArray(v)) value = [...new Set(v.filter((x): x is string => typeof x === "string" && sp.values.includes(x)))];
    if (value === undefined || same(value, current[field] ?? (sp.type === "list" ? [] : sp.type === "bool" ? false : null))) continue;
    items.push({ field, value, current: current[field] ?? null, reason: String(reasons[field] ?? "").slice(0, 1000) });
  }
  return { summary: summaryOf(raw), items };
}

/** Validace návrhů VEX – jen nálezy z kontextu, platný stav a u „nezasaženo“ platné zdůvodnění. */
export function parseVexItems(
  raw: unknown,
  known: Map<string, { vulnId: string; componentRef: string }>,
  statuses: readonly string[],
  justifications: readonly string[],
): { summary: string | null; items: VexItem[] } {
  const seen = new Set<string>();
  const items: VexItem[] = [];
  for (const x of asList(raw, "findings").slice(0, 60) as Record<string, unknown>[]) {
    const id = String(x?.findingId ?? "");
    const f = known.get(id);
    const status = String(x?.status ?? "");
    if (!f || seen.has(id) || !statuses.includes(status) || status === "under_investigation") continue;
    const just = typeof x.justification === "string" && justifications.includes(x.justification) ? x.justification : null;
    if (status === "not_affected" && !just) continue;
    seen.add(id);
    const txt = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
    items.push({ findingId: id, vulnId: f.vulnId, componentRef: f.componentRef, status, justification: status === "not_affected" ? just : null, impactStatement: txt(x.impactStatement, 2000), actionStatement: txt(x.actionStatement, 2000), reason: String(x.reason ?? "").slice(0, 1000) });
  }
  return { summary: summaryOf(raw), items };
}

/** Validace triáže nálezů skenu: nález z kontextu, duplicita jen vůči jinému nálezu z kontextu, u falešně pozitivního zdůvodnění. */
export function parseVulnTriageItems(raw: unknown, known: Map<string, { title: string }>, candidates: Map<string, { title: string }>): { summary: string | null; items: VulnTriageItem[] } {
  const seen = new Set<string>();
  const items: VulnTriageItem[] = [];
  for (const x of asList(raw, "findings").slice(0, 80) as Record<string, unknown>[]) {
    const id = String(x?.findingId ?? "");
    const f = known.get(id);
    const action = String(x?.action ?? "");
    if (!f || seen.has(id) || !["duplicate", "false_positive", "verify"].includes(action)) continue;
    const reason = String(x.reason ?? "").trim().slice(0, 1000);
    let dup: string | null = null;
    if (action === "duplicate") {
      dup = String(x.duplicateOfId ?? "");
      if (dup === id || !(candidates.has(dup) || known.has(dup))) continue;
    }
    if (action === "false_positive" && reason.length < 5) continue;
    seen.add(id);
    items.push({ findingId: id, action: action as VulnTriageItem["action"], duplicateOfId: dup, title: f.title, duplicateTitle: dup ? (candidates.get(dup) ?? known.get(dup))!.title : null, reason });
  }
  return { summary: summaryOf(raw), items };
}

/** Validace vytěžení zprávy: druh, text, kritérium jen z nabídky, opatření jen z kontextu, bez duplicit textu. */
export function parseReportItems(raw: unknown, controls: Map<string, string>, criteria: Set<string>): { summary: string | null; items: ReportExtractItem[] } {
  const items: ReportExtractItem[] = [];
  const seen = new Set<string>();
  const txt = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
  for (const key of ["cuecs", "exceptions", "csocs"] as const) {
    const itemKind = key === "cuecs" ? "cuec" : key === "exceptions" ? "exception" : "csoc";
    for (const x of asList(raw, key).slice(0, 80) as Record<string, unknown>[]) {
      const text = txt(x?.text, 5000);
      if (!text || text.length < 10) continue;
      const norm = `${itemKind}|${text.toLowerCase().replace(/\s+/g, " ")}`;
      if (seen.has(norm)) continue;
      seen.add(norm);
      const crit = txt(x.criterion, 50)?.toUpperCase() ?? null;
      const cid = typeof x.controlId === "string" && controls.has(x.controlId) ? x.controlId : null;
      const sev = itemKind === "exception" && ["low", "medium", "high"].includes(String(x.severity)) ? (String(x.severity) as "low") : null;
      items.push({ itemKind, ref: txt(x.ref, 100), text, criterion: crit && criteria.has(crit) ? crit : null, controlId: itemKind === "cuec" ? cid : null, controlName: itemKind === "cuec" && cid ? controls.get(cid)! : null, severity: sev, managementResponse: itemKind === "exception" ? txt(x.managementResponse, 5000) : null, reason: String(x.reason ?? "").slice(0, 1000) });
    }
  }
  return { summary: summaryOf(raw), items };
}

/** Validace návrhů odpovědí: otázka z dávky, odpověď z výčtu, zdroje jen z kandidátů otázky; bez zdroje nejvýš „low“. */
export function parseQaAnswers(raw: unknown, known: Map<string, { question: string; candidates: Map<string, QaAnswerItem["sources"][number]> }>): { summary: string | null; items: QaAnswerItem[] } {
  const items: QaAnswerItem[] = [];
  const seen = new Set<string>();
  for (const x of asList(raw, "answers").slice(0, 60) as Record<string, unknown>[]) {
    const id = String(x?.itemId ?? "");
    const k = known.get(id);
    if (!k || seen.has(id)) continue;
    const answer = ["yes", "no", "partial", "na"].includes(String(x.answer)) ? (String(x.answer) as QaAnswerItem["answer"]) : null;
    const answerText = typeof x.text === "string" && x.text.trim() ? x.text.trim().slice(0, 3000) : typeof x.answerText === "string" && x.answerText.trim() ? x.answerText.trim().slice(0, 3000) : null;
    if (!answer && !answerText) continue;
    seen.add(id);
    const sources = (Array.isArray(x.sources) ? x.sources : [])
      .map((s) => (s && typeof s === "object" ? k.candidates.get(`${(s as { kind?: unknown }).kind}:${(s as { id?: unknown }).id}`) : undefined))
      .filter((s): s is QaAnswerItem["sources"][number] => !!s)
      .filter((s, i, a) => a.findIndex((o) => o.kind === s.kind && o.id === s.id) === i)
      .slice(0, 5);
    const conf = ["low", "medium", "high"].includes(String(x.confidence)) ? (String(x.confidence) as QaAnswerItem["confidence"]) : "low";
    items.push({ itemId: id, question: k.question.slice(0, 300), answer, answerText, sources, confidence: sources.length ? conf : "low", reason: String(x.reason ?? "").slice(0, 1000) });
  }
  return { summary: summaryOf(raw), items };
}

/** Popisky polí návrhů typu „set“ (screening AI Act, triáž incidentu). */
export const AI_SET_FIELD_LABELS: Record<string, string> = {
  prohibited: "Zakázané praktiky (čl. 5)",
  annexIII: "Vysoce rizikové použití (příloha III)",
  annexI: "Bezpečnostní komponenta výrobku (příloha I)",
  exception: "Výjimka čl. 6 odst. 3",
  profiling: "Profilování fyzických osob",
  transparency: "Transparentnost (čl. 50)",
  gpai: "Obecný model AI (GPAI)",
  publicService: "Veřejný subjekt / veřejné služby",
  personalData: "Zpracovává osobní údaje",
  kind: "Druh",
  category: "Kategorie",
  cause: "Příčina",
  suspectedUnlawful: "Podezření na protiprávní jednání",
  personalDataBreach: "Porušení zabezpečení osobních údajů",
};
