import { STATUS_COLORS } from "@/components/health";
import { useT } from "@/lib/i18n";
import type { MsgKey, OpsLevel } from "@contix/shared";
import { AlertTriangle, CheckCircle2, CircleDashed, OctagonX, type LucideIcon } from "lucide-react";

/* ============================================================
 * Jednotný stav (v1.58.1): tečka a štítek stejně na Přehledu i ve Zprávě pro vedení.
 * Barva + ikona + text – barva není jediný nosič informace.
 * ============================================================ */

export type StatusLevel = OpsLevel | "empty";

export const LEVEL_STYLE: Record<StatusLevel, { color: string; Icon: LucideIcon; text: string; label: MsgKey }> = {
  error: { color: STATUS_COLORS.critical, Icon: OctagonX, text: "text-red-700", label: "status.error" },
  warning: { color: STATUS_COLORS.serious, Icon: AlertTriangle, text: "text-amber-800", label: "status.warning" },
  ok: { color: STATUS_COLORS.good, Icon: CheckCircle2, text: "text-emerald-700", label: "status.ok" },
  off: { color: STATUS_COLORS.neutral, Icon: CircleDashed, text: "text-slate-500", label: "status.off" },
  empty: { color: STATUS_COLORS.neutral, Icon: CircleDashed, text: "text-slate-500", label: "status.empty" },
};

export const tint = (color: string, pct = 14) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

/** Malá barevná tečka s jemným lemem. */
export function StatusDot({ level, className = "" }: { level: StatusLevel; className?: string }) {
  const s = LEVEL_STYLE[level];
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${className}`} style={{ background: s.color, boxShadow: `0 0 0 3px ${tint(s.color, 18)}` }} aria-hidden />;
}

/** Štítek stavu: jemně podbarvený, ikona + text. `label` přepíše výchozí text. */
export function StatusPill({ level, label, className = "" }: { level: StatusLevel; label?: string; className?: string }) {
  const t = useT();
  const s = LEVEL_STYLE[level];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${s.text} ${className}`} style={{ background: tint(s.color, 12) }}>
      <s.Icon size={13} aria-hidden /> {label ?? t(s.label)}
    </span>
  );
}
