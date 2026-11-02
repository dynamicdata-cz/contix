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
