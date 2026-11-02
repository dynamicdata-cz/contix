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
