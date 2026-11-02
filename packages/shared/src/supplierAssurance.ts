import { z } from "zod";
import { patchOf } from "./zutil";

/* ============================================================
 * Zprávy o ujištění od dodavatelů (v1.03, ADR-098) – SOC 2 / SOC 1 / ISO 27001 / penetrační test.
 * Ze zprávy se evidují doplňkové kontroly na straně uživatele (CUEC), výjimky z testování a kontroly
 * subdodavatelů (CSOC / carve-out). CUEC se mapují na vlastní opatření, výjimky se posoudí a případně
 * se z nich založí riziko dodavatele. Text zprávy se zpracuje jen na serveru (lokální AI), nic se neodesílá.
 * ============================================================ */

export const SUPPLIER_REPORT_KINDS = ["soc2_type2", "soc2_type1", "soc1_type2", "iso27001", "pentest", "other"] as const;
export type SupplierReportKind = (typeof SUPPLIER_REPORT_KINDS)[number];
export const REPORT_OPINIONS = ["unmodified", "qualified", "adverse", "disclaimer"] as const;
export type ReportOpinion = (typeof REPORT_OPINIONS)[number];
export const REPORT_ITEM_KINDS = ["cuec", "exception", "csoc"] as const;
export type ReportItemKind = (typeof REPORT_ITEM_KINDS)[number];
export const REPORT_ITEM_STATUSES = ["open", "addressed", "not_applicable", "accepted"] as const;
export type ReportItemStatus = (typeof REPORT_ITEM_STATUSES)[number];
export const REPORT_ITEM_SEVERITIES = ["low", "medium", "high"] as const;
export type ReportItemSeverity = (typeof REPORT_ITEM_SEVERITIES)[number];

const day = z.string().date();
export const SupplierReportInput = z.object({
  supplierId: z.string().uuid(),
  kind: z.enum(SUPPLIER_REPORT_KINDS).default("soc2_type2"),
  title: z.string().trim().min(1).max(300),
  serviceAuditor: z.string().trim().max(300).optional().nullable(),
  /** Období testování (Type II) nebo datum (Type I, certifikát). */
  periodFrom: day.optional().nullable(),
  periodTo: day.optional().nullable(),
  asOf: day.optional().nullable(),
  opinion: z.enum(REPORT_OPINIONS).optional().nullable(),
  /** Do kdy zprávu považujeme za platnou (výchozí konec období + 12 měsíců). */
  validUntil: day.optional().nullable(),
  /** Subdodavatelé vyňatí ze zprávy (carve-out) – např. poskytovatel cloudu. */
  subserviceOrgs: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  /** Most (bridge letter) od dodavatele pokrývá období do… */
  bridgeUntil: day.optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
});
export type SupplierReportInput = z.input<typeof SupplierReportInput>;
export const SupplierReportPatch = patchOf(SupplierReportInput.omit({ supplierId: true }));
export type SupplierReportPatch = z.input<typeof SupplierReportPatch>;

export const SupplierReportItemInput = z.object({
  kind: z.enum(REPORT_ITEM_KINDS),
  ref: z.string().trim().max(100).optional().nullable(),
  text: z.string().trim().min(3).max(5000),
  /** Kritérium SOC 2 (např. CC6.1) nebo bod přílohy ISO. */
  criterion: z.string().trim().max(50).optional().nullable(),
  /** Vlastní opatření, které CUEC pokrývá. */
  controlId: z.string().uuid().optional().nullable(),
  status: z.enum(REPORT_ITEM_STATUSES).default("open"),
  severity: z.enum(REPORT_ITEM_SEVERITIES).optional().nullable(),
  /** Odpověď vedení dodavatele (u výjimky). */
  managementResponse: z.string().trim().max(5000).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
});
export type SupplierReportItemInput = z.input<typeof SupplierReportItemInput>;
export const SupplierReportItemPatch = patchOf(SupplierReportItemInput);
export type SupplierReportItemPatch = z.input<typeof SupplierReportItemPatch>;

export interface SupplierReportItemDto {
  id: string;
  kind: ReportItemKind;
  ref: string | null;
  text: string;
  criterion: string | null;
  controlId: string | null;
  controlName: string | null;
  /** Stav vlastního opatření (implementace / účinnost) – podklad pro posouzení CUEC. */
  controlStatus: string | null;
  controlEffectiveness: string | null;
  status: ReportItemStatus;
  severity: ReportItemSeverity | null;
  managementResponse: string | null;
  note: string | null;
  riskId: string | null;
  riskName: string | null;
  source: "manual" | "ai";
}

export interface SupplierReportGap {
  code: "expired" | "expiring" | "opinion" | "bridge" | "cuec_unmapped" | "cuec_weak" | "exception_open" | "subservice" | "no_file";
  level: "high" | "medium" | "low";
  n?: number;
}

export interface SupplierReportDto {
  id: string;
  companyId: string;
  supplierId: string;
  supplierName: string;
  kind: SupplierReportKind;
  title: string;
  serviceAuditor: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  asOf: string | null;
  opinion: ReportOpinion | null;
  validUntil: string | null;
  bridgeUntil: string | null;
  subserviceOrgs: string[];
  notes: string | null;
  fileName: string | null;
  hasText: boolean;
  reviewedAt: string | null;
  reviewedByName: string | null;
  counts: Record<ReportItemKind, number>;
  gaps: SupplierReportGap[];
  createdAt: string;
}

export interface SupplierReportDetailDto extends SupplierReportDto {
  items: SupplierReportItemDto[];
  textPreview: string | null;
}

const addMonths = (d: string, m: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + m);
  return x.toISOString().slice(0, 10);
};

/** Výchozí platnost: konec období (nebo datum zprávy) + 12 měsíců. */
export function defaultReportValidity(r: { periodTo?: string | null; asOf?: string | null }): string | null {
  const base = r.periodTo ?? r.asOf ?? null;
  return base ? addMonths(base, 12) : null;
}

/**
 * Mezery zprávy (čistá funkce, nepersistovat): platnost, výrok, „most“ k dnešku (konec období starší 3 měsíců),
 * nenamapované / slabě pokryté CUEC, otevřené výjimky bez rozhodnutí, vyňatí subdodavatelé bez posouzení.
 */
export function supplierReportGaps(
  r: { kind: SupplierReportKind; opinion: ReportOpinion | null; validUntil: string | null; periodTo: string | null; bridgeUntil: string | null; subserviceOrgs: string[]; hasFile: boolean },
  items: { kind: ReportItemKind; status: ReportItemStatus; controlId: string | null; controlStatus?: string | null; controlEffectiveness?: string | null; riskId?: string | null }[],
  now = new Date(),
): SupplierReportGap[] {
  const today = now.toISOString().slice(0, 10);
  const g: SupplierReportGap[] = [];
  if (r.validUntil && r.validUntil < today) g.push({ code: "expired", level: "high" });
  else if (r.validUntil && r.validUntil <= addMonths(today, 1)) g.push({ code: "expiring", level: "medium" });
  if (r.opinion && r.opinion !== "unmodified") g.push({ code: "opinion", level: "high" });
  const coverTo = r.bridgeUntil && r.periodTo && r.bridgeUntil > r.periodTo ? r.bridgeUntil : r.periodTo;
  if ((r.kind === "soc2_type2" || r.kind === "soc1_type2") && coverTo && coverTo < addMonths(today, -3)) g.push({ code: "bridge", level: "medium" });
  const cuec = items.filter((i) => i.kind === "cuec" && i.status !== "not_applicable");
  const unmapped = cuec.filter((i) => !i.controlId && i.status !== "accepted").length;
  if (unmapped) g.push({ code: "cuec_unmapped", level: "medium", n: unmapped });
  const weak = cuec.filter((i) => i.controlId && (i.controlStatus === "planned" || i.controlStatus === "not_implemented" || i.controlEffectiveness === "ineffective")).length;
  if (weak) g.push({ code: "cuec_weak", level: "high", n: weak });
  const exc = items.filter((i) => i.kind === "exception" && i.status === "open" && !i.riskId).length;
  if (exc) g.push({ code: "exception_open", level: "high", n: exc });
  const csocOpen = items.filter((i) => i.kind === "csoc" && i.status === "open").length;
  if (r.subserviceOrgs.length && csocOpen) g.push({ code: "subservice", level: "low", n: csocOpen });
  if (!r.hasFile) g.push({ code: "no_file", level: "low" });
  return g;
}

export const SUPPLIER_REPORT_LABELS = {
  kind: {
    soc2_type2: "SOC 2 Type II",
    soc2_type1: "SOC 2 Type I",
    soc1_type2: "SOC 1 Type II (ISAE 3402)",
    iso27001: "Certifikát ISO/IEC 27001",
    pentest: "Penetrační test",
    other: "Jiná zpráva / atestace",
  } satisfies Record<SupplierReportKind, string>,
  opinion: { unmodified: "Bez výhrad", qualified: "S výhradou", adverse: "Záporný", disclaimer: "Odmítnutí výroku" } satisfies Record<ReportOpinion, string>,
  itemKind: { cuec: "Kontrola na straně uživatele (CUEC)", exception: "Výjimka z testování", csoc: "Kontrola subdodavatele (CSOC)" } satisfies Record<ReportItemKind, string>,
  itemStatus: { open: "K posouzení", addressed: "Pokryto / vyřešeno", not_applicable: "Netýká se nás", accepted: "Přijato" } satisfies Record<ReportItemStatus, string>,
  severity: { low: "Nízká", medium: "Střední", high: "Vysoká" } satisfies Record<ReportItemSeverity, string>,
  gap: {
    expired: "Platnost zprávy skončila – vyžádejte aktuální zprávu.",
    expiring: "Platnost zprávy brzy skončí.",
    opinion: "Výrok auditora není bez výhrad.",
    bridge: "Období zprávy skončilo před více než 3 měsíci – vyžádejte „bridge letter“.",
    cuec_unmapped: "Kontroly na straně uživatele (CUEC) bez vlastního opatření",
    cuec_weak: "CUEC pokryté opatřením, které není zavedené nebo účinné",
    exception_open: "Výjimky z testování bez posouzení nebo rizika",
    subservice: "Vyňatí subdodavatelé (carve-out) – posuďte jejich zprávy",
    no_file: "Zpráva není přiložena.",
  } satisfies Record<SupplierReportGap["code"], string>,
} as const;
