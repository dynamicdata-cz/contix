import { z } from "zod";

/* ============================================================
 * Reakce s potvrzením (v0.60, ADR-055): okamžitá upozornění na závažné alerty a zásahy SOC, které se provedou
 * až po schválení (princip čtyř očí). Automaticky jen blokace IP přes Wazuh Active Response se samostatným účtem;
 * ostatní zásahy (zakázání účtu, reset hesla, izolace) provede člověk a CONTIX vede záznam pro NIS2 / audit.
 * ============================================================ */

export const SOC_ACTION_KINDS = ["block_ip", "disable_account", "reset_password", "isolate_host", "custom"] as const;
export type SocActionKind = (typeof SOC_ACTION_KINDS)[number];
/** Zásahy, které CONTIX po schválení provede sám (ostatní provede člověk a označí jako hotové). */
export const SOC_AUTOMATED_ACTIONS: SocActionKind[] = ["block_ip"];

export const SOC_ACTION_STATUSES = ["proposed", "approved", "done", "failed", "rejected", "cancelled"] as const;
export type SocActionStatus = (typeof SOC_ACTION_STATUSES)[number];
export const SOC_ACTION_OPEN: SocActionStatus[] = ["proposed", "approved"];

export const SOC_NOTIFY_LEVELS = ["off", "high", "critical"] as const;
export type SocNotifyLevel = (typeof SOC_NOTIFY_LEVELS)[number];

export interface SocResponseSettings {
  /** Okamžité upozornění analytikům na nový alert od této závažnosti (e-mail / Teams z nastavení upozornění). */
  notifyMinSeverity: SocNotifyLevel;
  /** Schvaluje jiný člověk než navrhovatel. */
  fourEyes: boolean;
  /** Blokace IP přes Wazuh Active Response (samostatný účet API s právem active-response:command). */
  activeResponseEnabled: boolean;
  wazuhUser: string;
  hasWazuhPassword: boolean;
  /** Příkaz Active Response; „!“ = skript na agentovi bez definice v ossec.conf. */
  blockCommand: string;
}
export const SOC_RESPONSE_DEFAULTS: SocResponseSettings = { notifyMinSeverity: "critical", fourEyes: true, activeResponseEnabled: false, wazuhUser: "", hasWazuhPassword: false, blockCommand: "!firewall-drop" };

export const SocResponseSettingsInput = z.object({
  notifyMinSeverity: z.enum(SOC_NOTIFY_LEVELS).optional(),
  fourEyes: z.boolean().optional(),
  activeResponseEnabled: z.boolean().optional(),
  wazuhUser: z.string().trim().max(120).optional(),
  /** Prázdný řetězec = smazat, vynechat = ponechat. */
  wazuhPassword: z.string().max(500).optional(),
  blockCommand: z
    .string()
    .trim()
    .regex(/^!?[a-zA-Z0-9_.-]{2,64}$/, "Neplatný název příkazu Active Response")
    .optional(),
});
export type SocResponseSettingsInput = z.input<typeof SocResponseSettingsInput>;

const AGENT_ID = /^\d{3,6}$/;
export const SocActionInput = z
  .object({
    kind: z.enum(SOC_ACTION_KINDS),
    target: z.string().trim().min(1).max(500),
    /** Agenti Wazuh, na kterých se blokace provede (jen block_ip). */
    agentIds: z.array(z.string().trim().regex(AGENT_ID, "Neplatné ID agenta Wazuh")).max(50).default([]),
    reason: z.string().trim().min(3).max(2000),
    alertId: z.string().uuid().optional(),
    caseId: z.string().uuid().optional(),
    companyId: z.string().uuid().optional(),
  })
  .refine((x) => x.kind !== "block_ip" || x.agentIds.length > 0, { message: "Vyberte alespoň jednoho agenta Wazuh, na kterém se IP zablokuje.", path: ["agentIds"] });
export type SocActionInput = z.input<typeof SocActionInput>;

export const SocActionDecision = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(2000).default("") });
export type SocActionDecision = z.input<typeof SocActionDecision>;
export const SocActionComplete = z.object({ success: z.boolean(), note: z.string().trim().min(3).max(2000) });
export type SocActionComplete = z.input<typeof SocActionComplete>;

export interface SocActionDto {
  id: string;
  companyId: string;
  kind: SocActionKind;
  automated: boolean;
  target: string;
  agentIds: string[];
  reason: string;
  status: SocActionStatus;
  alertId: string | null;
  alertTitle: string | null;
  caseId: string | null;
  requestedById: string | null;
  requestedByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  executedByName: string | null;
  executedAt: string | null;
  result: string | null;
  createdAt: string;
  /** Smí aktuální uživatel schválit (soc:respond, čtyři oči). */
  canDecide: boolean;
  /** Smí označit ruční zásah jako provedený. */
  canComplete: boolean;
  canCancel: boolean;
}

export const SOC_ACTION_LABELS = {
  kind: { block_ip: "Blokovat IP (Wazuh Active Response)", disable_account: "Zakázat účet", reset_password: "Vynutit změnu hesla", isolate_host: "Izolovat zařízení", custom: "Jiný zásah" } as Record<SocActionKind, string>,
  status: { proposed: "Čeká na schválení", approved: "Schváleno – provést", done: "Provedeno", failed: "Selhalo", rejected: "Zamítnuto", cancelled: "Zrušeno" } as Record<SocActionStatus, string>,
  notify: { off: "Vypnuto", high: "Vysoká a kritická", critical: "Jen kritická" } as Record<SocNotifyLevel, string>,
};
