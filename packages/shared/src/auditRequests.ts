import { z } from "zod";
import { patchOf } from "./zutil";

/* ============================================================
 * Portál externího auditora (ADR-071): požadavky na podklady (PBC – „prepared by client“) k auditu, důkazy od vlastníků,
 * připomínky, převzetí auditorem. Externí auditor vidí jen audity, ke kterým je přidělen, a jen odeslané soubory.
 * ============================================================ */

export const AUDIT_REQUEST_STATUSES = ["open", "submitted", "returned", "accepted", "cancelled"] as const;
export type AuditRequestStatus = (typeof AUDIT_REQUEST_STATUSES)[number];
export const AUDIT_REQUEST_LABELS: Record<AuditRequestStatus, string> = {
  open: "Čeká na podklady",
  submitted: "Odesláno auditorovi",
  returned: "Vráceno k doplnění",
  accepted: "Převzato auditorem",
  cancelled: "Zrušeno",
};

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable();

export const AuditRequestInput = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(5000).optional().nullable(),
  /** Odkaz na požadavek / kritérium (např. CC6.1, A.5.15, § 7). */
  reference: z.string().trim().max(100).optional().nullable(),
  ownerPositionId: z.string().uuid().optional().nullable(),
  dueDate: date,
});
export type AuditRequestInput = z.input<typeof AuditRequestInput>;
export const AuditRequestPatch = patchOf(AuditRequestInput).extend({ status: z.enum(["open", "cancelled"]).optional() });

/** Hromadné založení: řádky „název; odkaz; termín“. */
export const AuditRequestBulk = z.object({ lines: z.string().max(100_000), ownerPositionId: z.string().uuid().optional().nullable(), dueDate: date });

export function parseRequestLines(text: string): { title: string; reference: string | null; dueDate: string | null }[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 500)
    .map((l) => {
      const [title = "", reference = "", due = ""] = l.split(/\s*[;\t]\s*/);
      const d = due.match(/^(\d{4}-\d{2}-\d{2})$/)?.[1] ?? due.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/)?.slice(1).reverse().map((x, i) => (i ? x.padStart(2, "0") : x)).join("-") ?? null;
      return { title: title.slice(0, 300), reference: reference.slice(0, 100) || null, dueDate: d };
    })
    .filter((r) => r.title);
}

export const AuditCommentInput = z.object({ body: z.string().trim().min(1).max(5000) });
export const AuditReturnInput = z.object({ comment: z.string().trim().min(1).max(5000) });
export const AuditAuditorsInput = z.object({ userIds: z.array(z.string().uuid()).max(20) });

export interface AuditRequestFileDto {
  id: string;
  filename: string;
  size: number;
  sha256: string;
  shared: boolean;
  uploadedAt: string;
  uploadedByName: string | null;
}
export interface AuditRequestCommentDto {
  id: string;
  body: string;
  external: boolean;
  authorName: string | null;
  createdAt: string;
}
export interface AuditRequestDto {
  id: string;
  auditId: string;
  code: string;
  title: string;
  description: string | null;
  reference: string | null;
  ownerPositionId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  status: AuditRequestStatus;
  submittedAt: string | null;
  acceptedAt: string | null;
  files: number;
  comments: number;
  overdue: boolean;
  /** Smí přihlášený uživatel nahrávat a odeslat (vlastník nebo správce auditu). */
  canProvide: boolean;
}
export interface AuditRequestDetail extends AuditRequestDto {
  fileList: AuditRequestFileDto[];
  commentList: AuditRequestCommentDto[];
  canReview: boolean;
}
export interface AuditPortalDto {
  audit: { id: string; code: string | null; title: string; status: string; plannedStart: string | null; plannedEnd: string | null };
  requests: AuditRequestDto[];
  auditors: { id: string; displayName: string; email: string }[];
  summary: Record<AuditRequestStatus, number> & { overdue: number };
  role: "internal" | "external";
  canManage: boolean;
}

export const requestCode = (seq: number) => `PBC-${String(seq).padStart(3, "0")}`;
