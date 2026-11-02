import { z } from "zod";
import { FrameworkIdSchema } from "./frameworks";

/* ============================================================
 * Verze dokumentů ISMS – snímky (snapshoty) se schválením a prokazatelným seznámením.
 *  - zpráva o hodnocení rizik (§ 8 odst. 1 písm. e vyhl. 409/2025),
 *  - prohlášení o aplikovatelnosti (§ 8 odst. 1 písm. f) / přehled bezpečnostních opatření (§ 3 odst. 2 vyhl. 410/2025,
 *    uchovávat alespoň 4 roky),
 *  - plán zvládání rizik (§ 8 odst. 1 písm. g).
 * Vrcholné vedení se s nimi prokazatelně seznamuje (§ 4 odst. 2 vyhl. 409/2025, § 4 písm. d vyhl. 410/2025).
 * ============================================================ */

export const DOC_KINDS = ["risk_report", "soa", "treatment_plan", "isms_review"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const DOC_STATUSES = ["draft", "approved", "superseded"] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export const DOC_LABELS = {
  kind: {
    risk_report: "Zpráva o hodnocení rizik",
    soa: "Prohlášení o aplikovatelnosti",
    treatment_plan: "Plán zvládání rizik",
    isms_review: "Zpráva o přezkoumání systému řízení bezpečnosti informací",
  } satisfies Record<DocKind, string>,
  status: { draft: "Návrh", approved: "Schváleno", superseded: "Nahrazeno" } satisfies Record<DocStatus, string>,
  legal: {
    risk_report: "§ 8 odst. 1 písm. e) vyhlášky č. 409/2025 Sb.",
    soa: "§ 8 odst. 1 písm. f) vyhlášky č. 409/2025 Sb.",
    treatment_plan: "§ 8 odst. 1 písm. g) vyhlášky č. 409/2025 Sb.",
    isms_review: "§ 3 písm. f) a g) vyhlášky č. 409/2025 Sb.",
  } satisfies Record<DocKind, string>,
} as const;

/** U rámce vyhl. 410 se SoA jmenuje „Přehled bezpečnostních opatření“. */
export function docTitle(kind: DocKind, framework?: string | null) {
  if (kind === "soa" && framework === "cz410") return "Přehled bezpečnostních opatření";
  return DOC_LABELS.kind[kind];
}

/** Doba uchování schválených verzí (vyhl. 410 § 3 odst. 2 písm. c: alespoň 4 roky). */
export const DOC_RETENTION_YEARS = 4;

/** Vstupy, které hodnocení rizik zohledňuje (§ 8 odst. 1 písm. c) body 1–8 vyhl. 409/2025). */
export const RISK_REPORT_INPUTS = [
  { key: "threats", label: "Relevantní hrozby a zranitelnosti a možné dopady na aktiva (z hodnocení aktiv dle § 7)" },
  { key: "changes", label: "Významné změny" },
  { key: "scope", label: "Změny stanoveného rozsahu podle § 12 zákona" },
  { key: "countermeasures", label: "Protiopatření podle § 20 zákona" },
  { key: "incidents", label: "Kybernetické bezpečnostní incidenty, včetně dříve řešených" },
  { key: "audits", label: "Výsledky auditů kybernetické bezpečnosti a kontrol" },
  { key: "tests", label: "Výsledky penetračního testování a skenování zranitelností" },
  { key: "effectiveness", label: "Výsledky vyhodnocení účinnosti systému řízení bezpečnosti informací" },
] as const;

export const CreateDocumentInput = z.object({
  /** Společnost skupiny, do které záznam patří (výchozí = aktivní společnost). */
  companyId: z.string().uuid().optional(),
  kind: z.enum(DOC_KINDS),
  framework: FrameworkIdSchema.nullable().optional(),
  title: z.string().trim().max(300).optional().nullable(),
  note: z.string().trim().max(5000).optional().nullable(),
  /** Zpráva o hodnocení rizik: zohlednění vstupů § 8 odst. 1 písm. c); přezkoumání ISMS: body § 3 písm. f), závěry. */
  inputs: z.record(z.string(), z.string().trim().max(5000)).default({}),
  /** Období, za které se hodnotí (volitelné). */
  periodFrom: z.string().date().nullable().optional(),
  periodTo: z.string().date().nullable().optional(),
});
export type CreateDocumentInput = z.input<typeof CreateDocumentInput>;

export const ApproveDocumentInput = z.object({ note: z.string().trim().max(2000).optional().nullable() });

export interface DocumentVersionDto {
  id: string;
  kind: DocKind;
  framework: string | null;
  version: number;
  title: string;
  status: DocStatus;
  note: string | null;
  /** Klíčové ukazatele snímku (pro porovnání verzí). */
  metrics: Record<string, number>;
  createdByName: string | null;
  createdAt: string;
  approvedByName: string | null;
  approvedAt: string | null;
  approvalNote: string | null;
  retainUntil: string | null;
  acknowledgements: { userId: string; userName: string; at: string }[];
  acknowledgedByMe: boolean;
  canApprove: boolean;
  canDelete: boolean;
}
