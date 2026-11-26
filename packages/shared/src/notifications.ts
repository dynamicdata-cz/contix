import { z } from "zod";

/* ============================================================
 * Povinnosti a upozornění na lhůty – e-mail (SMTP), Microsoft Teams, přehled v aplikaci.
 * Povinnosti se nepersistují – sbírá je `collectObligations` z evidence (stejně jako lhůty incidentů).
 * ============================================================ */

export const OBLIGATION_KINDS = [
  "incident_report",
  "risk_action",
  "risk_review",
  "risk_trigger",
  "exercise",
  "cert_expiry",
  "audit_request",
  "finding",
  "audit",
  "isms_review",
  "change",
  "policy_review",
  "policy_ack",
  "training",
  "plan_test",
  "contract",
  "assessment_cycle",
  "control_test",
  "evidence_expiry",
  "processing_review",
  "ai_review",
  "cra_report",
  "cra_support",
  "doc_approval",
  "doc_retention",
  "access_review",
  "legal_review",
  "legal_task",
  "exception_expiry",
  "supplier_questionnaire",
  "supplier_report",
  "task",
  "soc_sla",
  "vuln_remediation",
  "info_assessment",
  "access_approval",
  "access_certification",
  "project_gate",
  "project_task",
  "project_change",
  "guide_step",
  "nukib_notice",
  // v1.88 (ADR-183): výpadek nebo varování zdroje dat (agent, koncentrátor, sběrač, Wazuh, konektory, nespárované servery)
  "data_source",
  // v1.105 (ADR-199): platnost certifikátu / osvědčení osoby
  "person_cert",
] as const;
export type ObligationKind = (typeof OBLIGATION_KINDS)[number];

export const OBLIGATION_LABELS: Record<ObligationKind, string> = {
  doc_approval: "Kontrola / schválení dokumentu",
  doc_retention: "Skartace / archivace dokumentu",
  access_review: "Přezkum přístupů",
  access_approval: "Schválení žádosti o přístup",
  access_certification: "Recertifikace oprávnění",
  project_gate: "Brána projektu",
  project_task: "Úkol v projektu",
  project_change: "Změna projektu ke schválení",
  guide_step: "Další krok postupu",
  nukib_notice: "Ohlášení regulované služby NÚKIB",
  legal_review: "Posouzení změny předpisu",
  legal_task: "Úkol ze změny předpisu",
  exception_expiry: "Konec platnosti výjimky",
  supplier_questionnaire: "Bezpečnostní dotazník dodavatele",
  supplier_report: "Platnost zprávy dodavatele (SOC 2, ISO 27001)",
  task: "Úkol",
  soc_sla: "Lhůta alertu / případu SOC",
  vuln_remediation: "Oprava zranitelností",
  info_assessment: "Posouzení informace NÚKIB",
  incident_report: "Hlášení incidentu",
  risk_action: "Akce plánu zvládání rizik",
  risk_review: "Přehodnocení rizika",
  risk_trigger: "Podnět k přehodnocení rizika",
  exercise: "Cvičení",
  cert_expiry: "Certifikát před vypršením",
  audit_request: "Podklady pro audit",
  finding: "Nápravné opatření z auditu",
  audit: "Audit kybernetické bezpečnosti",
  isms_review: "Přezkoumání ISMS",
  change: "Významná změna",
  policy_review: "Přezkum dokumentu",
  policy_ack: "Seznámení s dokumentem",
  training: "Školení",
  plan_test: "Test plánu kontinuity",
  contract: "Smlouva s dodavatelem",
  assessment_cycle: "Pravidelné hodnocení rizik / BIA",
  control_test: "Test opatření",
  evidence_expiry: "Platnost důkazu",
  person_cert: "Platnost certifikátu osoby",
  processing_review: "Přezkum činnosti zpracování (GDPR)",
  ai_review: "Přezkum AI systému a FRIA (AI Act)",
  cra_report: "Hlášení zranitelnosti / incidentu produktu (CRA čl. 14)",
  cra_support: "Konec podpůrného období produktu (CRA)",
  data_source: "Zdroj dat (agent, koncentrátor, konektor)",
};

export type ObligationUrgency = "overdue" | "today" | "soon" | "later";

export interface ObligationItem {
  /** Stabilní klíč (pro odstranění duplicitních upozornění), např. "risk_action:<id>". */
  key: string;
  kind: ObligationKind;
  title: string;
  detail: string | null;
  companyId: string;
  /** Termín (datum nebo okamžik ISO). */
  due: string | null;
  urgency: ObligationUrgency;
  /** Odkaz v aplikaci (cesta SPA). */
  link: string;
  /** Odpovědné funkční místo (pokud je). */
  ownerPositionId: string | null;
  ownerName: string | null;
  /** Akce proveditelná přímo z fronty Moje práce (v1.37, ADR-134); server ji vždy znovu ověří. */
  action?: ObligationAction | null;
  /**
   * Eskalace v hierarchii (v1.60, ADR-155): položka po termínu odpovědné funkce, kterou vidí nadřízený.
   * level 1 = vedoucí útvaru, 2 = vedoucí nadřazeného útvaru…; přibývá po týdnu po termínu.
   */
  escalation?: ObligationEscalation | null;
  /** Osoba, které je položka přidělena přímo (úkol bez funkčního místa, v1.62). */
  assigneeUserId?: string | null;
  /** Zástupce odpovědné osoby, který položku také vidí (úkoly z nálezů – zástupce technického garanta, v1.62). */
  deputyUserId?: string | null;
}

export interface ObligationEscalation {
  level: number;
  daysOverdue: number;
}

/** Celé dny po termínu (0 = v termínu). */
export function daysOverdue(due: string | null, now = new Date()): number {
  if (!due) return 0;
  const d = Date.parse(`${due.slice(0, 10)}T00:00:00Z`);
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.max(0, Math.round((today - d) / 86_400_000));
}

export type ObligationAction =
  | { type: "access_decide"; requestId: string }
  | { type: "project_change"; projectId: string; changeId: string }
  | { type: "project_task_done"; projectId: string; taskId: string }
  | { type: "task_done"; taskId: string };

export const NotificationSettingsInput = z.object({
  emailEnabled: z.boolean().optional(),
  smtpHost: z.string().trim().max(255).nullable().optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  /** true = TLS od začátku (465), false = STARTTLS (587/25). */
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().trim().max(255).nullable().optional(),
  /** Heslo SMTP – ukládá se šifrovaně, nevrací se. Prázdný řetězec = smazat. */
  smtpPassword: z.string().max(500).optional(),
  smtpFrom: z.string().trim().max(320).nullable().optional(),
  teamsEnabled: z.boolean().optional(),
  /** URL příchozího webhooku / Workflows (Power Automate) – šifrovaně, nevrací se. */
  teamsWebhookUrl: z.string().trim().max(2000).optional(),
  /** Hodina denního souhrnu (místní čas serveru). */
  digestHour: z.number().int().min(0).max(23).optional(),
  /** Kolik dní předem upozorňovat. */
  leadDays: z.number().int().min(1).max(90).optional(),
  /** Pouze pracovní dny pro souhrny. */
  weekdaysOnly: z.boolean().optional(),
});
export type NotificationSettingsInput = z.input<typeof NotificationSettingsInput>;

export interface NotificationSettingsDto {
  emailEnabled: boolean;
  smtpHost: string | null;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string | null;
  smtpPasswordSet: boolean;
  smtpFrom: string | null;
  teamsEnabled: boolean;
  teamsWebhookSet: boolean;
  digestHour: number;
  leadDays: number;
  weekdaysOnly: boolean;
  lastRunAt: string | null;
  lastResult: string | null;
}

/** Naléhavost termínu vůči „teď“ a předstihu upozornění. */
export function urgencyOf(due: string | null, leadDays: number, now = new Date()): ObligationUrgency {
  if (!due) return "later";
  const t = due.length <= 10 ? new Date(`${due}T23:59:59`) : new Date(due);
  const ms = t.getTime() - now.getTime();
  if (ms < 0) return "overdue";
  if (ms < 24 * 3600_000) return "today";
  if (ms < leadDays * 24 * 3600_000) return "soon";
  return "later";
}

export const URGENCY_LABELS: Record<ObligationUrgency, string> = { overdue: "Po termínu", today: "Dnes", soon: "Blíží se", later: "Později" };
