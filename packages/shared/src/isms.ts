import { z } from "zod";
import { patchOf } from "./zutil";

/* ============================================================
 * Řízení ISMS (modul `isms`):
 *  - řízení změn a evidence významných změn – § 11 vyhl. č. 409/2025 Sb.
 *    (souvisí § 3 písm. f) bod 7, písm. h) bod 4, § 8 odst. 1 písm. c) bod 2, § 16 odst. 4 písm. a), § 24 odst. 5 písm. a) bod 3),
 *  - cíle ISMS – § 3 písm. a), § 4 odst. 1 písm. b),
 *  - vyhodnocení účinnosti ISMS a zpráva o přezkoumání – § 3 písm. f) a g), seznámení vedení § 4 odst. 2 písm. a).
 * ============================================================ */

export const CHANGE_TYPES = ["technical", "application", "network", "organizational", "process", "supplier", "scope", "other"] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const CHANGE_STATUSES = ["proposed", "assessed", "approved", "implemented", "closed", "rejected", "rolled_back"] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

/** § 11 odst. 3 (penetrační test) a § 16 odst. 4 písm. a) (audit v rozsahu změny). */
export const CHANGE_DECISIONS = ["not_assessed", "not_needed", "planned", "done"] as const;
export type ChangeDecision = (typeof CHANGE_DECISIONS)[number];

export const CHANGE_LABELS = {
  type: {
    technical: "Technické aktivum (HW, OS, platforma)",
    application: "Aplikace / vývoj",
    network: "Komunikační síť a architektura",
    organizational: "Organizační změna, bezpečnostní role",
    process: "Proces / postup",
    supplier: "Dodavatel",
    scope: "Stanovený rozsah (§ 12 zákona)",
    other: "Jiná",
  } satisfies Record<ChangeType, string>,
  status: {
    proposed: "Navržená",
    assessed: "Posouzená",
    approved: "Schválená",
    implemented: "Provedená",
    closed: "Uzavřená",
    rejected: "Zamítnutá",
    rolled_back: "Vrácená zpět",
  } satisfies Record<ChangeStatus, string>,
  decision: { not_assessed: "Nerozhodnuto", not_needed: "Není třeba", planned: "Plánováno", done: "Provedeno" } satisfies Record<ChangeDecision, string>,
} as const;

/**
 * Výchozí kritéria pro určení významné změny (§ 11 odst. 1 písm. a). Povinná osoba si je stanoví sama –
 * v Administraci → Nastavení lze seznam upravit. Jde o návrh CONTIX, nikoli text vyhlášky.
 */
export const DEFAULT_CHANGE_CRITERIA = [
  "Změna primárního aktiva nebo podpůrného aktiva s vysokou či kritickou úrovní důvěrnosti, integrity nebo dostupnosti",
  "Změna architektury, segmentace nebo perimetru komunikační sítě",
  "Změna stanoveného rozsahu podle § 12 zákona",
  "Nový významný dodavatel, změna dodavatele nebo přesun zpracování či provozu mimo území ČR",
  "Změna mechanismů řízení přístupu, autentizace nebo kryptografie",
  "Zavedení nové technologie pro regulovanou službu (cloud, AI, vzdálený přístup)",
  "Změna s možným dopadem na dostupnost regulované služby nad stanovené RTO",
  "Organizační změna s vlivem na bezpečnostní role nebo odpovědnosti v ISMS",
];

const text = (max = 10000) => z.string().trim().max(max).optional().nullable();
const date = z.string().date().nullable().optional();
const ids = z.array(z.string().uuid()).default([]);

export const ChangeInput = z.object({
  /** Společnost skupiny, do které záznam patří (výchozí = aktivní společnost). */
  companyId: z.string().uuid().optional(),
  code: z.string().trim().max(50).optional().nullable(),
  title: z.string().trim().min(1).max(300),
  description: text(),
  changeType: z.enum(CHANGE_TYPES).default("technical"),
  status: z.enum(CHANGE_STATUSES).default("proposed"),
  ownerPositionId: z.string().uuid().nullable().optional(),
  requestedBy: text(200),
  plannedAt: date,
  implementedAt: date,
  /** § 11 odst. 1 písm. b) – změna má nebo může mít vliv na kybernetickou bezpečnost. */
  affectsSecurity: z.boolean().default(false),
  /** § 11 odst. 1 písm. c) – významná změna podle stanovených kritérií. */
  significant: z.boolean().default(false),
  criteria: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  significanceReason: text(),
  /** § 11 odst. 2 písm. b) – řízení rizik spojených se změnou. */
  riskAssessment: text(),
  /** § 11 odst. 2 písm. c) – bezpečnostní opatření ke snížení nepříznivých dopadů. */
  measures: text(),
  /** § 11 odst. 2 písm. d) – aktualizace bezpečnostní a provozní dokumentace. */
  docsUpdatedAt: date,
  docsNote: text(2000),
  /** § 11 odst. 2 písm. e) – testování před uvedením do provozu. */
  testedAt: date,
  testResult: text(),
  /** § 11 odst. 2 písm. f) – možnost navrácení do původního stavu. */
  rollbackPlan: text(),
  /** § 11 odst. 3 – rozhodnutí o penetračním testu (§ 24 odst. 5). */
  pentest: z.enum(CHANGE_DECISIONS).default("not_assessed"),
  pentestNote: text(2000),
  /** § 16 odst. 4 písm. a) – audit kybernetické bezpečnosti v rozsahu významné změny. */
  audit: z.enum(CHANGE_DECISIONS).default("not_assessed"),
  auditNote: text(2000),
  assetIds: ids,
  processIds: ids,
  riskIds: ids,
  controlIds: ids,
  supplierIds: ids,
});
export type ChangeInput = z.input<typeof ChangeInput>;
export const ChangePatch = patchOf(ChangeInput.omit({ companyId: true }));

export interface ChangeListItem {
  id: string;
  companyId: string;
  code: string | null;
  title: string;
  changeType: ChangeType;
  status: ChangeStatus;
  affectsSecurity: boolean;
  significant: boolean;
  ownerPositionName: string | null;
  plannedAt: string | null;
  implementedAt: string | null;
  approvedAt: string | null;
  /** Nesplněné kroky § 11 odst. 2 a 3 u významné změny. */
  gaps: string[];
  assetCount: number;
  riskCount: number;
  updatedAt: string;
}

export interface ChangeDetail extends ChangeListItem {
  description: string | null;
  ownerPositionId: string | null;
  requestedBy: string | null;
  criteria: string[];
  significanceReason: string | null;
  riskAssessment: string | null;
  measures: string | null;
  docsUpdatedAt: string | null;
  docsNote: string | null;
  testedAt: string | null;
  testResult: string | null;
  rollbackPlan: string | null;
  pentest: ChangeDecision;
  pentestNote: string | null;
  audit: ChangeDecision;
  auditNote: string | null;
  approvedByName: string | null;
  createdByName: string | null;
  createdAt: string;
  assets: { id: string; name: string; assetType: string }[];
  processes: { id: string; code: string | null; name: string }[];
  risks: { id: string; code: string | null; name: string; level: string | null }[];
  controls: { id: string; code: string | null; name: string }[];
  suppliers: { id: string; name: string; significant: boolean }[];
  canEdit: boolean;
}

const ORDER: Record<ChangeStatus, number> = { proposed: 0, assessed: 1, approved: 2, implemented: 3, closed: 4, rejected: -1, rolled_back: 3 };

/** Nesplněné povinnosti § 11 u významné změny podle fáze, ve které je. */
export function changeGaps(c: {
  significant: boolean;
  status: ChangeStatus;
  criteria: string[];
  significanceReason?: string | null;
  riskAssessment?: string | null;
  riskCount: number;
  measures?: string | null;
  controlCount: number;
  docsUpdatedAt?: string | null;
  testedAt?: string | null;
  rollbackPlan?: string | null;
  pentest: ChangeDecision;
  audit: ChangeDecision;
}): string[] {
  if (!c.significant || c.status === "rejected") return [];
  const o = ORDER[c.status];
  const g: string[] = [];
  if (!c.criteria.length && !c.significanceReason) g.push("Není uvedeno, podle kterého kritéria je změna významná (§ 11 odst. 1 písm. c).");
  if (!c.riskAssessment && !c.riskCount) g.push("Chybí řízení rizik spojených se změnou (§ 11 odst. 2 písm. b).");
  if (o >= 2 && !c.measures && !c.controlCount) g.push("Nejsou uvedena bezpečnostní opatření ke snížení dopadů (§ 11 odst. 2 písm. c).");
  if (o >= 2 && !c.rollbackPlan) g.push("Chybí postup navrácení do původního stavu (§ 11 odst. 2 písm. f).");
  if (o >= 2 && c.pentest === "not_assessed") g.push("Není rozhodnuto o penetračním testování (§ 11 odst. 3).");
  if (o >= 3 && !c.testedAt) g.push("Není doloženo testování před uvedením do provozu (§ 11 odst. 2 písm. e).");
  if (o >= 4 && !c.docsUpdatedAt) g.push("Není doložena aktualizace bezpečnostní a provozní dokumentace (§ 11 odst. 2 písm. d).");
  if (o >= 4 && c.audit !== "done" && c.audit !== "planned") g.push("Chybí audit kybernetické bezpečnosti v rozsahu změny (§ 16 odst. 4 písm. a).");
  if (o >= 4 && c.pentest === "planned") g.push("Plánovaný penetrační test nebyl proveden (§ 24 odst. 5 písm. a) bod 3).");
  return g;
}

/* ---------- cíle ISMS ---------- */

export const OBJECTIVE_STATUSES = ["not_evaluated", "met", "partially_met", "not_met", "cancelled"] as const;
export type ObjectiveStatus = (typeof OBJECTIVE_STATUSES)[number];
export const OBJECTIVE_LABELS: Record<ObjectiveStatus, string> = {
  not_evaluated: "Nevyhodnoceno",
  met: "Splněno",
  partially_met: "Částečně splněno",
  not_met: "Nesplněno",
  cancelled: "Zrušeno",
};

export const ObjectiveInput = z.object({
  /** Společnost skupiny, do které záznam patří (výchozí = aktivní společnost). */
  companyId: z.string().uuid().optional(),
  code: z.string().trim().max(50).optional().nullable(),
  title: z.string().trim().min(1).max(300),
  description: text(),
  /** Měřítko / ukazatel a cílová hodnota. */
  metric: text(500),
  target: text(200),
  currentValue: text(200),
  status: z.enum(OBJECTIVE_STATUSES).default("not_evaluated"),
  evaluation: text(),
  evaluatedAt: date,
  dueDate: date,
  ownerPositionId: z.string().uuid().nullable().optional(),
});
export type ObjectiveInput = z.input<typeof ObjectiveInput>;
export const ObjectivePatch = patchOf(ObjectiveInput.omit({ companyId: true }));

export interface ObjectiveDto {
  id: string;
  companyId: string;
  code: string | null;
  title: string;
  description: string | null;
  metric: string | null;
  target: string | null;
  currentValue: string | null;
  status: ObjectiveStatus;
  evaluation: string | null;
  evaluatedAt: string | null;
  dueDate: string | null;
  ownerPositionId: string | null;
  ownerPositionName: string | null;
  updatedAt: string;
}

/* ---------- vyhodnocení účinnosti a přezkoumání ISMS ---------- */

/** Obsah vyhodnocení účinnosti ISMS (§ 3 písm. f) body 1–7 vyhl. 409/2025) + závěry (písm. g) a aktualizace (písm. h). */
export const ISMS_REVIEW_INPUTS = [
  { key: "objectives", point: 1, label: "Vyhodnocení cílů systému řízení bezpečnosti informací" },
  { key: "plan", point: 2, label: "Posouzení naplňování plánu zvládání rizik" },
  { key: "state", point: 3, label: "Hodnocení stavu systému řízení bezpečnosti informací včetně revize hodnocení rizik" },
  { key: "audits", point: 4, label: "Posouzení výsledků provedených auditů kybernetické bezpečnosti a kontrol" },
  { key: "previous", point: 5, label: "Výsledky předchozího hodnocení účinnosti" },
  { key: "incidents", point: 6, label: "Posouzení dopadů kybernetických bezpečnostních incidentů na kybernetickou bezpečnost a poskytované služby" },
  { key: "changes", point: 7, label: "Posouzení významných změn podle § 11" },
  { key: "conclusions", point: null, label: "Závěry přezkoumání a celkové hodnocení účinnosti" },
  { key: "updates", point: null, label: "Rozhodnutí o aktualizaci ISMS a dokumentace (§ 3 písm. h) a zdrojích" },
] as const;

/** Přezkoumání se provádí alespoň jednou ročně (§ 3 písm. f). */
export const ISMS_REVIEW_MONTHS = 12;

export interface IsmsOverviewDto {
  lastReview: { id: string; version: number; approvedAt: string } | null;
  nextReviewDue: string | null;
  reviewOverdue: boolean;
  objectives: Record<ObjectiveStatus, number>;
  changes: { open: number; significantOpen: number; withGaps: number };
}
