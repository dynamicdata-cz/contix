import type { ObligationItem, ObligationKind } from "./notifications";

/* ============================================================
 * Úvodní přehled (dashboard) – souhrn všech oblastí v aktuálním rozsahu (společnost / skupina).
 * Oblast je null, pokud je modul vypnutý nebo uživatel nemá oprávnění ke čtení.
 * ============================================================ */

export interface DashboardDto {
  processes: { total: number; withoutOwner: number } | null;
  incidents: { open: number; openEvents: number; unassessed: number } | null;
  audits: { planned: number; openFindings: number; overdueFindings: number; major: number } | null;
  policies: { active: number; draft: number } | null;
  awareness: { courses: number } | null;
  suppliers: { total: number; significant: number } | null;
  isms: { openChanges: number; significantOpen: number } | null;
  continuity: { bia: number; plans: number; approvedPlans: number } | null;
  ai: { proposed: number } | null;
  gdpr: { activities: number; drafts: number; dpiaMissing: number } | null;
  identity: { sources: number; sourceErrors: number; open: number; critical: number; high: number; privileged: number } | null;
  obligations: {
    overdue: number;
    soon: number;
    byKind: Partial<Record<ObligationKind, { overdue: number; soon: number }>>;
    top: ObligationItem[];
  } | null;
}


/* ---------- technické karty Přehledu jedním dotazem (v1.102, ADR-196) ---------- */

/**
 * Souhrn technických oblastí pro Přehled. Každá část je null, když je modul vypnutý nebo uživatel nemá oprávnění
 * (stejné rozhodnutí jako u samostatné obrazovky). Přenáší jen čísla – ne seznamy certifikátů ani mapu zón.
 */
export interface DashboardTechDto {
  sectests: import("./securityTests").SecTestSummaryDto | null;
  monitoring: { open: { critical: number; high: number; medium: number; low: number } } | null;
  zones: { zones: number; assigned: number; unassigned: number; highFlows: number } | null;
  tls: { total: number; expired: number; expiring: number; withFindings: number; unscanned: number } | null;
  soc: import("./soc").SocSummaryDto | null;
  sca: { totals: { assets: number; pass: number; fail: number; score: number | null }; policies: number; lastSyncAt: string | null } | null;
  ops: { checks: { key: string; label: string; level: "ok" | "warning" | "error" | "off" }[]; lastSuccessfulBackupAt: string | null } | null;
}
