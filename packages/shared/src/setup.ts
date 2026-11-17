/* ============================================================
 * Průvodce prvním nastavením organizace a předávací protokol (v0.26)
 * ============================================================ */

export const SETUP_STEP_KEYS = [
  "organization",
  "security",
  "sso",
  "structure",
  "users",
  "assets",
  "risks",
  "controls",
  "documentation",
  "awareness",
  "notifications",
  "ai",
  "identity",
  "operations",
] as const;
export type SetupStepKey = (typeof SETUP_STEP_KEYS)[number];
export type SetupStatus = "done" | "partial" | "todo" | "skipped";

export const SETUP_LABELS = {
  status: { done: "Hotovo", partial: "Rozpracováno", todo: "Chybí", skipped: "Modul vypnut" } satisfies Record<SetupStatus, string>,
};

export interface SetupStepDto {
  key: SetupStepKey;
  title: string;
  /** Proč na kroku záleží (povinnost / doporučení). */
  why: string;
  status: SetupStatus;
  /** Co je hotovo a co chybí – konkrétně. */
  detail: string[];
  /** Kde se krok nastavuje. */
  link: string;
  optional: boolean;
  /** Téma nápovědy k tomuto kroku. */
  helpTopic?: string;
}

export interface SetupDto {
  steps: SetupStepDto[];
  /** Povinné kroky hotové / celkem. */
  done: number;
  total: number;
  ready: boolean;
  /** Lze založit výchozí strukturu složek dokumentace (žádné složky zatím nejsou). */
  canCreateDocFolders: boolean;
}

/** Výchozí struktura dokumentace podle § 6 vyhl. 409 (lze upravit). */
export const DEFAULT_DOC_FOLDERS: { name: string; codePrefix: string; children?: { name: string; codePrefix?: string }[] }[] = [
  { name: "Bezpečnostní politika", codePrefix: "PO" },
  { name: "Směrnice ISMS", codePrefix: "SM", children: [{ name: "Řízení přístupu" }, { name: "Provoz a komunikace" }, { name: "Incidenty a kontinuita" }] },
  { name: "Provozní dokumentace a postupy", codePrefix: "PP" },
  { name: "Plány", codePrefix: "PL" },
  { name: "Záznamy a evidence", codePrefix: "ZA" },
];

/* ---------- průvodce prvním nastavením nové instalace (v1.73, ADR-166) ---------- */

/** Výchozí název organizace na nové instalaci (kořenová společnost). */
export const DEFAULT_ORG_NAME = "Moje organizace";

export const WIZARD_STEPS = ["organization", "users", "structure", "ranges", "assets"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export interface WizardStepDto {
  key: WizardStep;
  done: boolean;
  /** Krok se netýká (modul vypnutý). */
  skipped: boolean;
  /** Počet záznamů kroku (uživatelé, útvary, rozsahy, aktiva). */
  count: number;
}
export interface SetupWizardDto {
  steps: WizardStepDto[];
  done: number;
  total: number;
  /** Kdy správce průvodce dokončil (nebo přeskočil) – pak se už nenabízí na přehledu. */
  finishedAt: string | null;
  organizationName: string;
  company: { id: string; name: string; ico: string | null; address: string | null } | null;
  /** Přihlašování: zda je nastavené SSO / AD (nový uživatel pak nepotřebuje heslo). */
  login: { oidc: boolean; ad: boolean };
}

/** Dočasné heslo pro nového uživatele z průvodce (16 znaků, bez zaměnitelných znaků). */
export function temporaryPassword(rand: (n: number) => Uint8Array): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const b = rand(16);
  let s = "";
  for (let i = 0; i < 16; i++) s += abc[b[i]! % abc.length];
  // aspoň jedna číslice a velké / malé písmeno
  return `${s.slice(0, 13)}A7k`;
}
