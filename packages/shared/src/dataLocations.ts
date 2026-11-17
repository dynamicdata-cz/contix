import { z } from "zod";

/* ============================================================
 * Umístění dat (v1.52, ADR-149): hosting / cloud / SaaS, země a pravidla, která se na ni vztahují.
 * Pravidla jsou orientační (CONTIX) – právní posouzení předání nenahrazují.
 * ============================================================ */

/** EU a EHP (GDPR platí přímo). */
export const EU_EEA = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO"] as const;

/**
 * Rozhodnutí Komise o odpovídající ochraně (čl. 45 GDPR) – stav k 10. 11. 2026 (commission.europa.eu).
 * `partial`: Kanada jen obchodní organizace, USA jen organizace v EU-US Data Privacy Framework.
 */
export const ADEQUACY: Record<string, { name: string; partial?: "commercial" | "dpf" }> = {
  AD: { name: "Andorra" },
  AR: { name: "Argentina" },
  BR: { name: "Brazílie" },
  CA: { name: "Kanada", partial: "commercial" },
  FO: { name: "Faerské ostrovy" },
  GG: { name: "Guernsey" },
  IL: { name: "Izrael" },
  IM: { name: "Ostrov Man" },
  JP: { name: "Japonsko" },
  JE: { name: "Jersey" },
  NZ: { name: "Nový Zéland" },
  KR: { name: "Korejská republika" },
  CH: { name: "Švýcarsko" },
  GB: { name: "Spojené království" },
  US: { name: "USA", partial: "dpf" },
  UY: { name: "Uruguay" },
};

/** Státy, u nichž CONTIX doporučuje zvláštní posouzení rizika dodavatele (právo umožňující státu přístup k datům, varování NÚKIB). */
export const ELEVATED_RISK_COUNTRIES = ["CN", "RU", "BY", "IR", "KP"] as const;

export const DATA_CATEGORIES = ["personal", "special", "customer", "business", "backup", "logs"] as const;
export type DataCategory = (typeof DATA_CATEGORIES)[number];
export const DATA_CATEGORY_LABELS: Record<DataCategory, string> = {
  personal: "Osobní údaje",
  special: "Zvláštní kategorie osobních údajů",
  customer: "Data zákazníků",
  business: "Interní / obchodní data",
  backup: "Zálohy",
  logs: "Logy a záznamy událostí",
};

export const TRANSFER_MECHANISMS = ["adequacy", "dpf", "scc", "bcr", "derogation", "none"] as const;
export type TransferMechanism = (typeof TRANSFER_MECHANISMS)[number];
export const DATA_TRANSFER_LABELS: Record<TransferMechanism, string> = {
  adequacy: "Rozhodnutí o odpovídající ochraně",
  dpf: "EU-US Data Privacy Framework",
  scc: "Standardní smluvní doložky (SCC)",
  bcr: "Závazná podniková pravidla (BCR)",
  derogation: "Výjimka (čl. 49 GDPR)",
  none: "Bez záruk",
};

export const DataLocationInput = z.object({
  companyId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  supplierId: z.string().uuid().nullable().optional(),
  provider: z.string().trim().max(200).nullable().optional(),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Země: dvoupísmenný kód ISO (CZ, DE, US…)"),
  region: z.string().trim().max(100).nullable().optional(),
  dataCategories: z.array(z.enum(DATA_CATEGORIES)).max(DATA_CATEGORIES.length).default([]),
  transferMechanism: z.enum(TRANSFER_MECHANISMS).nullable().optional(),
  dpaSigned: z.boolean().default(false),
  note: z.string().trim().max(2000).nullable().optional(),
});
export type DataLocationInput = z.input<typeof DataLocationInput>;

export type LocationRuleCode =
  | "gdpr_eu"
  | "gdpr_adequacy"
  | "gdpr_dpf_check"
  | "gdpr_transfer_safeguards"
  | "gdpr_transfer_missing"
  | "gdpr_dpa_missing"
  | "supply_chain_risk"
  | "dora_third_country";

export interface LocationRule {
  code: LocationRuleCode;
  level: "ok" | "info" | "warning" | "error";
}

export const LOCATION_RULE_LABELS: Record<LocationRuleCode, string> = {
  gdpr_eu: "EU / EHP – GDPR platí přímo, předání do třetí země se neřeší",
  gdpr_adequacy: "Země s rozhodnutím o odpovídající ochraně (čl. 45 GDPR)",
  gdpr_dpf_check: "USA: předání jen organizaci certifikované v EU-US DPF, jinak SCC – ověřte certifikaci",
  gdpr_transfer_safeguards: "Třetí země se zárukami (SCC / BCR / výjimka) – zdokumentujte posouzení dopadu předání (TIA)",
  gdpr_transfer_missing: "Osobní údaje ve třetí zemi bez záruk (kapitola V GDPR)",
  gdpr_dpa_missing: "Chybí smlouva o zpracování osobních údajů (čl. 28 GDPR)",
  supply_chain_risk: "Země se zvýšeným rizikem – posuďte dodavatele (zákon o kybernetické bezpečnosti, varování NÚKIB)",
  dora_third_country: "DORA: ICT služba ze třetí země – posouzení rizik a koncentrace (čl. 28–29)",
};

/** Pravidla pro umístění: GDPR (EU/EHP, odpovídající ochrana, záruky), smlouva o zpracování, riziko země, DORA. */
export function locationRules(loc: { country: string; dataCategories: readonly string[]; transferMechanism?: string | null; dpaSigned?: boolean }, opts: { doraEntity?: boolean } = {}): LocationRule[] {
  const c = loc.country.toUpperCase();
  const personal = loc.dataCategories.includes("personal") || loc.dataCategories.includes("special");
  const eu = (EU_EEA as readonly string[]).includes(c);
  const out: LocationRule[] = [];
  if (eu) out.push({ code: "gdpr_eu", level: "ok" });
  else if (personal) {
    const adq = ADEQUACY[c];
    const tm = loc.transferMechanism ?? null;
    if (adq?.partial === "dpf") out.push({ code: tm === "dpf" || tm === "scc" || tm === "bcr" ? "gdpr_dpf_check" : "gdpr_transfer_missing", level: tm === "dpf" || tm === "scc" || tm === "bcr" ? "info" : "error" });
    else if (adq && !adq.partial) out.push({ code: "gdpr_adequacy", level: "ok" });
    else if (adq?.partial === "commercial") out.push({ code: "gdpr_adequacy", level: "info" });
    else if (tm && tm !== "none" && tm !== "adequacy") out.push({ code: "gdpr_transfer_safeguards", level: "info" });
    else out.push({ code: "gdpr_transfer_missing", level: "error" });
  }
  if (personal && !loc.dpaSigned) out.push({ code: "gdpr_dpa_missing", level: "warning" });
  if ((ELEVATED_RISK_COUNTRIES as readonly string[]).includes(c)) out.push({ code: "supply_chain_risk", level: "warning" });
  if (opts.doraEntity && !eu) out.push({ code: "dora_third_country", level: "info" });
  return out;
}

export interface DataLocationDto {
  id: string;
  companyId: string;
  name: string;
  supplierId: string | null;
  supplierName: string | null;
  provider: string | null;
  country: string;
  region: string | null;
  dataCategories: DataCategory[];
  transferMechanism: TransferMechanism | null;
  dpaSigned: boolean;
  note: string | null;
  rules: LocationRule[];
  tags: string[];
  updatedAt: string;
}
