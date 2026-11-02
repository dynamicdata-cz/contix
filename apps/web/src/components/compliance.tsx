import { lbl } from "@/lib/i18n";
import { STATUS_COLORS } from "@/components/health";
import { Badge, type Tone } from "@/components/ui";
import { CONTROL_LABELS, type Compliance, type ControlStatus } from "@contix/shared";

/** Míra shody – stavová paleta (vždy s textem), neaplikované a neposouzené neutrálně. */
export const COMPLIANCE_COLOR: Record<Compliance, string> = {
  compliant: STATUS_COLORS.good,
  partial: STATUS_COLORS.serious,
  non_compliant: STATUS_COLORS.critical,
  not_assessed: STATUS_COLORS.neutral,
  not_applicable: "#e2e1dc",
};
export const COMPLIANCE_ORDER: Compliance[] = ["compliant", "partial", "non_compliant", "not_assessed", "not_applicable"];

export const complianceTone: Record<Compliance, Tone> = {
  compliant: "green",
  partial: "amber",
  non_compliant: "red",
  not_assessed: "slate",
  not_applicable: "slate",
};
export const controlStatusTone: Record<ControlStatus, Tone> = {
  implemented: "green",
  in_progress: "blue",
  planned: "violet",
  not_implemented: "red",
  not_applicable: "slate",
};

export const ComplianceBadge = ({ c }: { c: Compliance }) => <Badge tone={complianceTone[c]}>{lbl(CONTROL_LABELS.compliance[c])}</Badge>;
export const ControlStatusBadge = ({ s }: { s: ControlStatus }) => <Badge tone={controlStatusTone[s]}>{lbl(CONTROL_LABELS.status[s])}</Badge>;

/** Vodorovný skládaný pruh podle míry shody (šířky = podíl), s popiskem v title. */
export function ComplianceBar({ counts, height = 10 }: { counts: Record<Compliance, number>; height?: number }) {
  const total = COMPLIANCE_ORDER.reduce((s, k) => s + (counts[k] ?? 0), 0) || 1;
  return (
    <div className="flex w-full gap-px overflow-hidden rounded-sm bg-slate-100" style={{ height }} role="img" aria-label={COMPLIANCE_ORDER.map((k) => `${lbl(CONTROL_LABELS.compliance[k])} ${counts[k]}`).join(", ")}>
      {COMPLIANCE_ORDER.filter((k) => counts[k]).map((k) => (
        <div key={k} title={`${lbl(CONTROL_LABELS.compliance[k])}: ${counts[k]}`} style={{ width: `${(counts[k] / total) * 100}%`, background: COMPLIANCE_COLOR[k] }} />
      ))}
    </div>
  );
}

export function ComplianceLegend({ counts }: { counts: Record<Compliance, number> }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {COMPLIANCE_ORDER.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COMPLIANCE_COLOR[k] }} aria-hidden />
          {lbl(CONTROL_LABELS.compliance[k])} <b className="tabular-nums text-slate-800">{counts[k] ?? 0}</b>
        </span>
      ))}
    </div>
  );
}

/** Procento shody – číslo je hlavní nositel informace. */
export function ScoreValue({ score, className = "" }: { score: number; className?: string }) {
  return <span className={`font-semibold tabular-nums ${className}`}>{score.toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} %</span>;
}
