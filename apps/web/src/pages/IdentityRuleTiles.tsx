import { SEVERITY_COLOR } from "@/components/health";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  IDENTITY_LABELS,
  IDENTITY_RULE_GROUPS,
  IDENTITY_RULE_INFO,
  identitySeverityRank,
  type IdentityFindingFacets,
  type IdentityInventory,
  type IdentityRule,
  type RuleBase,
} from "@contix/shared";
import { KeyRound, Monitor, Users } from "lucide-react";

/* ============================================================
 * Dlaždice nálezů podle pravidla (v1.92): skupiny Účty / Privilegovaný přístup / Počítače, barva podle nejvyšší
 * závažnosti, podíl z objektů v adresáři (aktivní / povolené). Kliknutí = filtr pravidla.
 * ============================================================ */

const ICON = { accounts: Users, privileged: KeyRound, computers: Monitor } as const;

export function RuleTiles({ facets, inv, active, onRule }: { facets: IdentityFindingFacets; inv?: IdentityInventory; active?: IdentityRule; onRule: (r: IdentityRule | undefined) => void }) {
  const t = useT();
  const baseOf = (b: RuleBase): number | null => {
    if (!inv || !b) return null;
    const pc = inv.computers;
    switch (b) {
      case "accounts":
        return inv.accounts.enabled;
      case "privileged":
        return inv.accounts.privileged;
      case "computers":
        return pc?.enabled ?? null;
      case "servers":
        return pc ? pc.server + pc.dc : null;
    }
  };
  const groups = IDENTITY_RULE_GROUPS.map((g) => {
    const rules = g.rules
      .map((r) => ({ ...r, n: facets.rules[r.rule] ?? 0, sev: facets.ruleSeverity?.[r.rule] ?? ("low" as const) }))
      .filter((r) => r.n > 0)
      .sort((a, b) => identitySeverityRank(b.sev) - identitySeverityRank(a.sev) || b.n - a.n);
    return { ...g, rules, total: rules.reduce((s, r) => s + r.n, 0) };
  }).filter((g) => g.rules.length);
  if (!groups.length) return null;

  return (
    <div className="mb-4 grid gap-4 xl:grid-cols-3" data-testid="idn-rule-tiles">
      {groups.map((g) => {
        const Icon = ICON[g.key];
        const base = baseOf(g.base);
        return (
          <section key={g.key} className="self-start rounded-xl border border-slate-200 bg-white" data-testid={`idn-rule-group-${g.key}`}>
            <header className="border-b border-slate-100 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <Icon size={15} className="text-slate-400" aria-hidden />
                <h3 className="text-sm font-semibold text-slate-800">{t.lbl(g.title)}</h3>
                <span className="ml-auto whitespace-nowrap text-xs font-medium text-slate-600">{t("idn.tiles.groupTotal", { n: g.total })}</span>
              </div>
              {base !== null && <p className="mt-0.5 pl-6 text-xs text-slate-500">{t.dyn(`idn.tiles.base.${g.base}`, "", { n: base })}</p>}
            </header>
            <div className="divide-y divide-slate-100">
              {g.rules.map((r) => {
                const on = active === r.rule;
                const b = baseOf(r.base);
                const pct = b ? Math.min(100, Math.round((r.n / b) * 100)) : null;
                return (
                  <button
                    key={r.rule}
                    type="button"
                    aria-pressed={on}
                    title={t.lbl(IDENTITY_RULE_INFO[r.rule].why)}
                    onClick={() => onRule(on ? undefined : r.rule)}
                    className={cn("relative flex w-full items-center gap-3 py-2 pl-4 pr-3 text-left transition-colors", on ? "bg-brand-50" : "hover:bg-slate-50")}
                  >
                    <span className="absolute inset-y-1.5 left-0 w-1 rounded-r" style={{ background: SEVERITY_COLOR[r.sev] }} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-sm", on ? "font-semibold text-brand-800" : "text-slate-800")}>{t.lbl(IDENTITY_RULE_INFO[r.rule].title)}</span>
                      <span className="flex items-center gap-2 text-xs text-slate-500">
                        {t.lbl(IDENTITY_LABELS.severity[r.sev])}
                        {pct !== null && (
                          <>
                            <span className="h-1 w-16 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                              <span className="block h-full rounded-full" style={{ width: `${Math.max(pct, 2)}%`, background: SEVERITY_COLOR[r.sev] }} />
                            </span>
                            <span className="tabular-nums">{t("idn.tiles.pct", { pct })}</span>
                          </>
                        )}
                      </span>
                    </span>
                    <span className={cn("text-lg font-semibold tabular-nums", on ? "text-brand-800" : "text-slate-900")}>{r.n}</span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
