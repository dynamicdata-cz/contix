import { LABELS } from "./asset";
import { CONTROL_LABELS } from "./controls";
import { PROCESS_LABELS } from "./process";
import { RISK_LABELS } from "./risk";

/* ============================================================
 * Import reálných dat z Excelu / CSV (v0.21): definice polí, automatické mapování sloupců,
 * převod hodnot (české popisky, ano/ne, data, seznamy). Sdíleno API (validace) a UI (mapování).
 * ============================================================ */

export const IMPORT_ENTITIES = ["assets", "risks", "processes", "controls", "suppliers"] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

export const IMPORT_ENTITY_LABELS: Record<ImportEntity, string> = {
  assets: "Aktiva",
  risks: "Rizika",
  processes: "Procesy",
  controls: "Opatření",
  suppliers: "Dodavatelé",
};

/** Modul a oprávnění k zápisu pro import dané evidence. */
export const IMPORT_ENTITY_META: Record<ImportEntity, { module: string; perm: string; path: string }> = {
  assets: { module: "assets", perm: "assets:write", path: "/assets" },
  risks: { module: "risks", perm: "risks:write", path: "/risks" },
  processes: { module: "processes", perm: "processes:write", path: "/processes" },
  controls: { module: "controls", perm: "controls:write", path: "/controls" },
  suppliers: { module: "suppliers", perm: "suppliers:write", path: "/suppliers" },
};

export type ImportFieldType = "text" | "longtext" | "enum" | "int" | "bool" | "list" | "date" | "position" | "user";

export interface ImportField {
  key: string;
  label: string;
  type: ImportFieldType;
  required?: boolean;
  /** enum: hodnota → český popisek */
  options?: Record<string, string>;
  /** Další názvy sloupců, podle kterých se pole rozpozná. */
  synonyms?: string[];
  min?: number;
  max?: number;
  hint?: string;
}

const yes = { true: "ano", false: "ne" };

export const IMPORT_FIELDS: Record<ImportEntity, ImportField[]> = {
  assets: [
    { key: "name", label: "Název", type: "text", required: true, synonyms: ["aktivum", "nazev aktiva", "asset", "jmeno"] },
    { key: "assetType", label: "Typ aktiva", type: "enum", required: true, options: LABELS.assetType, synonyms: ["typ", "druh", "type", "kategorie"] },
    { key: "criticality", label: "Kritičnost", type: "enum", options: LABELS.criticality, synonyms: ["dulezitost", "criticality"] },
    { key: "confidentiality", label: "Důvěrnost (1–4)", type: "int", min: 1, max: 4, synonyms: ["duvernost", "c", "confidentiality"] },
    { key: "integrity", label: "Integrita (1–4)", type: "int", min: 1, max: 4, synonyms: ["integrita", "i", "integrity"] },
    { key: "availability", label: "Dostupnost (1–4)", type: "int", min: 1, max: 4, synonyms: ["dostupnost", "a", "availability"] },
    { key: "description", label: "Popis", type: "longtext", synonyms: ["poznamka", "description"] },
    { key: "hostname", label: "Hostname", type: "text", synonyms: ["host", "nazev pocitace", "computer name", "dns"] },
    { key: "ipAddresses", label: "IP adresy", type: "list", synonyms: ["ip", "ip adresa", "ip address"] },
    { key: "macAddresses", label: "MAC adresy", type: "list", synonyms: ["mac", "mac adresa"] },
    { key: "osName", label: "Operační systém", type: "text", synonyms: ["os", "system"] },
    { key: "osVersion", label: "Verze OS", type: "text", synonyms: ["os verze", "os version"] },
    { key: "manufacturer", label: "Výrobce", type: "text", synonyms: ["vendor", "manufacturer"] },
    { key: "model", label: "Model", type: "text" },
    { key: "serialNumber", label: "Sériové číslo", type: "text", synonyms: ["seriove cislo", "sn", "serial", "s n", "vyrobni cislo"] },
    { key: "location", label: "Umístění", type: "text", synonyms: ["lokalita", "misto", "location", "umisteni"] },
    { key: "ownerName", label: "Odpovědný útvar / správce (text)", type: "text", synonyms: ["spravce", "odpovedny", "garant text", "utvar"] },
    { key: "ownerUserId", label: "Vlastník (e-mail uživatele)", type: "user", synonyms: ["vlastnik", "garant", "owner", "e mail vlastnika"] },
    { key: "lifecycleStatus", label: "Životní cyklus", type: "enum", options: LABELS.lifecycleStatus, synonyms: ["stav", "status", "zivotni cyklus"] },
    { key: "environment", label: "Prostředí", type: "enum", options: LABELS.environment, synonyms: ["prostredi", "environment"] },
    { key: "tags", label: "Štítky", type: "list", synonyms: ["stitky", "tagy", "tags"] },
  ],
  risks: [
    { key: "code", label: "Kód", type: "text", synonyms: ["id", "oznaceni", "cislo rizika", "kod rizika"] },
    { key: "name", label: "Název rizika", type: "text", required: true, synonyms: ["riziko", "nazev", "popis rizika"] },
    { key: "description", label: "Popis scénáře", type: "longtext", synonyms: ["popis", "scenar", "description"] },
    { key: "ownerPositionId", label: "Vlastník rizika (funkční místo)", type: "position", synonyms: ["vlastnik", "garant", "owner", "odpovedna osoba"] },
    { key: "status", label: "Stav", type: "enum", options: RISK_LABELS.status, synonyms: ["status"] },
    { key: "impact", label: "Dopad (hodnota aktiva)", type: "int", min: 1, max: 5, synonyms: ["dopad", "impact", "hodnota aktiva"] },
    { key: "threatLevel", label: "Úroveň hrozby", type: "int", min: 1, max: 5, synonyms: ["hrozba", "uroven hrozby", "threat"] },
    { key: "vulnLevel", label: "Úroveň zranitelnosti", type: "int", min: 1, max: 5, synonyms: ["zranitelnost", "uroven zranitelnosti", "vulnerability"] },
    { key: "treatment", label: "Způsob zvládání", type: "enum", options: RISK_LABELS.treatment, synonyms: ["zvladani", "osetreni", "treatment", "strategie"] },
    { key: "treatmentPlan", label: "Plán zvládání", type: "longtext", synonyms: ["opatreni", "plan", "plan zvladani"] },
    { key: "treatmentDue", label: "Termín zvládání", type: "date", synonyms: ["termin", "due", "termin zvladani"] },
  ],
  processes: [
    { key: "code", label: "Kód", type: "text", synonyms: ["id", "oznaceni", "kod procesu"] },
    { key: "name", label: "Název procesu", type: "text", required: true, synonyms: ["proces", "nazev", "cinnost"] },
    { key: "processType", label: "Typ procesu", type: "enum", options: PROCESS_LABELS.type, synonyms: ["typ", "druh"] },
    { key: "status", label: "Stav", type: "enum", options: PROCESS_LABELS.status, synonyms: ["status"] },
    { key: "criticality", label: "Kritičnost", type: "enum", options: LABELS.criticality, synonyms: ["dulezitost"] },
    { key: "ownerPositionId", label: "Vlastník procesu (funkční místo)", type: "position", synonyms: ["vlastnik", "garant", "owner"] },
    { key: "purpose", label: "Účel", type: "longtext", synonyms: ["ucel", "cil"] },
    { key: "description", label: "Popis", type: "longtext", synonyms: ["popis procesu"] },
    { key: "inputs", label: "Vstupy", type: "longtext", synonyms: ["vstup"] },
    { key: "outputs", label: "Výstupy", type: "longtext", synonyms: ["vystup"] },
    { key: "frequency", label: "Četnost", type: "text", synonyms: ["frekvence", "cetnost"] },
    { key: "legislation", label: "Legislativa", type: "longtext", synonyms: ["predpisy", "pravni zaklad"] },
  ],
  controls: [
    { key: "code", label: "Kód", type: "text", synonyms: ["id", "oznaceni", "kod opatreni"] },
    { key: "name", label: "Název opatření", type: "text", required: true, synonyms: ["opatreni", "nazev", "control"] },
    { key: "description", label: "Popis", type: "longtext", synonyms: ["popis opatreni"] },
    { key: "category", label: "Kategorie", type: "enum", options: CONTROL_LABELS.category, synonyms: ["typ", "druh"] },
    { key: "status", label: "Stav zavedení", type: "enum", options: CONTROL_LABELS.status, synonyms: ["stav", "status", "zavedeni"] },
    { key: "effectiveness", label: "Účinnost", type: "enum", options: CONTROL_LABELS.effectiveness, synonyms: ["ucinnost"] },
    { key: "ownerPositionId", label: "Odpovědné funkční místo", type: "position", synonyms: ["vlastnik", "garant", "odpovedny", "owner"] },
    { key: "implementation", label: "Způsob plnění", type: "longtext", synonyms: ["implementace", "zpusob zavedeni", "plneni"] },
    { key: "evidence", label: "Doložení (kde je kodifikováno)", type: "longtext", synonyms: ["dukaz", "dolozeni", "dokumentace"] },
    { key: "plannedDate", label: "Plánovaný termín", type: "date", synonyms: ["termin", "planovany termin"] },
    { key: "requirementIds", label: "Požadavky (ID, např. cz409:19/1)", type: "list", synonyms: ["pozadavky", "paragrafy", "mapovani"] },
  ],
  suppliers: [
    { key: "name", label: "Název dodavatele", type: "text", required: true, synonyms: ["dodavatel", "nazev", "firma", "spolecnost"] },
    { key: "ico", label: "IČO", type: "text", synonyms: ["ico", "ic"] },
    { key: "address", label: "Adresa", type: "longtext", synonyms: ["sidlo"] },
    { key: "country", label: "Země", type: "text", synonyms: ["stat", "zeme"] },
    { key: "contactName", label: "Kontaktní osoba", type: "text", synonyms: ["kontakt"] },
    { key: "contactEmail", label: "Kontaktní e-mail", type: "text", synonyms: ["email", "e mail"] },
    { key: "contactPhone", label: "Telefon", type: "text", synonyms: ["tel", "telefon"] },
    { key: "supplyDescription", label: "Předmět plnění", type: "longtext", synonyms: ["predmet", "sluzba", "plneni"] },
    { key: "significant", label: "Významný dodavatel (ano/ne)", type: "bool", options: yes, synonyms: ["vyznamny"] },
    { key: "dataOutsideCz", label: "Data mimo ČR (ano/ne)", type: "bool", options: yes, synonyms: ["mimo cr", "data mimo cr"] },
  ],
};

/** Normalizace pro porovnání (malá písmena, bez diakritiky a interpunkce). */
export const normalizeLabel = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Návrh mapování: záhlaví sloupce → pole (podle klíče, popisku a synonym). */
export function suggestMapping(entity: ImportEntity, headers: string[]): (string | null)[] {
  const fields = IMPORT_FIELDS[entity];
  const used = new Set<string>();
  return headers.map((h) => {
    const n = normalizeLabel(h);
    if (!n) return null;
    const hit = fields.find((f) => !used.has(f.key) && (normalizeLabel(f.key) === n || normalizeLabel(f.label) === n || (f.synonyms ?? []).some((s) => normalizeLabel(s) === n)));
    if (hit) used.add(hit.key);
    return hit?.key ?? null;
  });
}

export interface ParsedCell {
  value?: unknown;
  error?: string;
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/** Převod buňky na hodnotu pole. Prázdná buňka = undefined (pole se nevyplní). */
export function parseCell(field: ImportField, raw: string): ParsedCell {
  const v = raw.trim();
  if (!v) return {};
  switch (field.type) {
    case "text":
      return { value: v.slice(0, 500) };
    case "longtext":
      return { value: v.slice(0, 10000) };
    case "list":
      return { value: [...new Set(v.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean))] };
    case "int": {
      const m = v.match(/^-?\d+/);
      const n = m ? Number(m[0]) : NaN;
      if (!Number.isFinite(n) || (field.min != null && n < field.min) || (field.max != null && n > field.max)) return { error: `${field.label}: „${v}“ není číslo ${field.min}–${field.max}` };
      return { value: n };
    }
    case "bool": {
      const n = normalizeLabel(v);
      if (["ano", "a", "yes", "y", "true", "1", "x", "pravda"].includes(n)) return { value: true };
      if (["ne", "n", "no", "false", "0", "nepravda"].includes(n)) return { value: false };
      return { error: `${field.label}: „${v}“ – očekáváno ano/ne` };
    }
    case "date": {
      let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (m) return { value: `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}` };
      m = v.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
      if (m) return { value: `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}` };
      if (/^\d{5}(\.\d+)?$/.test(v)) return { value: new Date(EXCEL_EPOCH + Math.floor(Number(v)) * 86_400_000).toISOString().slice(0, 10) };
      return { error: `${field.label}: „${v}“ není datum (např. 31. 12. 2026)` };
    }
    case "enum": {
      const n = normalizeLabel(v);
      const opts = Object.entries(field.options ?? {});
      const hit =
        opts.find(([k, l]) => normalizeLabel(k) === n || normalizeLabel(l) === n) ??
        // částečná shoda popisku („Redukce“ → „Redukce rizika (opatření)“), jen pokud je jednoznačná
        (() => {
          const part = opts.filter(([, l]) => normalizeLabel(l).startsWith(n) || n.startsWith(normalizeLabel(l)));
          return part.length === 1 ? part[0] : undefined;
        })();
      if (!hit) return { error: `${field.label}: „${v}“ – povolené hodnoty: ${opts.map(([, l]) => l).join(", ")}` };
      return { value: hit[0] };
    }
    case "position":
    case "user":
      // přeloží API (funkční místo podle názvu, uživatel podle e-mailu)
      return { value: v };
  }
}

export interface ImportPreviewRow {
  /** Číslo řádku v souboru (1 = záhlaví). */
  row: number;
  /** Hodnoty po převodu (bez nepřeložených odkazů). */
  data: Record<string, unknown>;
  errors: string[];
  warnings: string[];
  action: "create" | "update" | "skip";
  matchId: string | null;
  matchLabel: string | null;
}

export interface ImportPreviewDto {
  entity: ImportEntity;
  sheets: string[];
  sheet: string | null;
  headers: string[];
  mapping: (string | null)[];
  /** Prvních několik řádků souboru tak, jak jsou (ukázka u mapování). */
  samples: string[][];
  rows: ImportPreviewRow[];
  total: number;
  counts: { create: number; update: number; skip: number; errors: number };
}

export interface ImportResultDto {
  created: number;
  updated: number;
  skipped: number;
  failed: { row: number; error: string }[];
}

export const IMPORT_MODES = ["upsert", "create_only"] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];
export const IMPORT_MAX_ROWS = 5000;
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
