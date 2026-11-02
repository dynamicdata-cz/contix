import { fmtDay } from "@/lib/utils";
import { lbl, tt } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { VULN_LABELS, type HealthStatus, type Severity, type SupportStatus } from "@contix/shared";
import { AlertTriangle, CheckCircle2, CircleHelp, OctagonX } from "lucide-react";

/**
 * Barvy semaforu a závažnosti.
 * - Semafor / podpora = STATUS paleta (good / serious / critical) – vždy s ikonou a textem, nikdy jen barvou.
 * - Závažnost CVE = ORDINÁLNÍ rampa jednoho odstínu (světlá → tmavá), ověřená validátorem
 *   (monotónní jas, rozestupy ≥ 0,06, světlý konec ≥ 2:1 proti ploše).
 */
export const STATUS_COLORS = { good: "#0ca30c", serious: "#ec835a", critical: "#d03b3b", neutral: "#b4b2ab" };

export const HEALTH_COLOR: Record<HealthStatus, string> = {
  green: STATUS_COLORS.good,
  orange: STATUS_COLORS.serious,
  red: STATUS_COLORS.critical,
  unknown: STATUS_COLORS.neutral,
};

export const SUPPORT_COLOR: Record<SupportStatus, string> = {
  supported: STATUS_COLORS.good,
  ending: STATUS_COLORS.serious,
  eol: STATUS_COLORS.critical,
  unknown: STATUS_COLORS.neutral,
};

/** Ordinální rampa: nízká → kritická. */
export const SEVERITY_COLOR: Record<Severity, string> = {
  low: "#ee9a78",
  medium: "#e0614a",
  high: "#b8302e",
  critical: "#7a1a1c",
  unknown: "#b4b2ab",
};
export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

const HEALTH_ICON = { green: CheckCircle2, orange: AlertTriangle, red: OctagonX, unknown: CircleHelp } as const;

/** Semafor: barevná ikona (tvar nese význam i bez barvy) + volitelně text. */
export function HealthIndicator({
  status,
  reasons,
  withLabel,
  size = 18,
}: {
  status: HealthStatus;
  reasons?: { text: string }[];
  withLabel?: boolean;
  size?: number;
}) {
  const Icon = HEALTH_ICON[status];
  const title = [lbl(VULN_LABELS.health[status]), ...(reasons ?? []).map((r) => `• ${r.text}`)].join("\n");
  return (
    <span className="inline-flex items-center gap-1.5" title={title} aria-label={title}>
      <Icon size={size} color={HEALTH_COLOR[status]} strokeWidth={2.25} aria-hidden />
      {withLabel && <span className="text-sm font-medium text-slate-800">{lbl(VULN_LABELS.health[status])}</span>}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SEVERITY_COLOR[severity] }} aria-hidden />
      {lbl(VULN_LABELS.severity[severity])}
    </span>
  );
}

/** Kompaktní počty K/V/S/N – číslo je v textové barvě, značka barvou. */
export function VulnCounts({ c, className }: { c: { critical: number; high: number; medium: number; low: number }; className?: string }) {
  const total = c.critical + c.high + c.medium + c.low;
  if (!total) return <span className="text-xs text-slate-400">—</span>;
  const items: [Severity, number, string][] = [
    ["critical", c.critical, "K"],
    ["high", c.high, "V"],
    ["medium", c.medium, "S"],
    ["low", c.low, "N"],
  ];
  return (
    <span className={cn("inline-flex items-center gap-2 text-xs tabular-nums text-slate-700", className)}>
      {items
        .filter(([, n]) => n > 0)
        .map(([s, n, l]) => (
          <span key={s} className="inline-flex items-center gap-1" title={`${lbl(VULN_LABELS.severity[s])}: ${n}`}>
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: SEVERITY_COLOR[s] }} aria-hidden />
            {l}&nbsp;{n}
          </span>
        ))}
    </span>
  );
}

export function SupportBadge({ status, eolDate }: { status: SupportStatus; eolDate?: string | null }) {
  const Icon = status === "supported" ? CheckCircle2 : status === "unknown" ? CircleHelp : status === "ending" ? AlertTriangle : OctagonX;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-slate-800">
      <Icon size={16} color={SUPPORT_COLOR[status]} strokeWidth={2.25} aria-hidden />
      {lbl(VULN_LABELS.support[status])}
      {eolDate && <span className="text-xs text-slate-500">({tt(status === "eol" ? "ast.odData" : "ast.doData", { date: fmtDay(eolDate) })})</span>}
    </span>
  );
}
