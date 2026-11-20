import { Card, CardHeader } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { AccountActivity, IdentityInventory } from "@contix/shared";
import type { ReactNode } from "react";

/* ============================================================
 * Inventář adresáře (v1.91, ADR-186) – kolik účtů, počítačů a skupin je aktivních. Kliknutí = filtr v záložce.
 * ============================================================ */

export type AccountPreset = { activity?: AccountActivity; disabled?: boolean; privileged?: boolean; kind?: string };
export type ComputerPreset = { view?: "active" | "stale" | "disabled"; role?: string };

function Row({ label, value, total, tone, onClick, testId }: { label: ReactNode; value: number; total?: number; tone?: "green" | "amber" | "red" | "slate"; onClick?: () => void; testId?: string }) {
  const pct = total ? Math.round((value / total) * 100) : null;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      data-testid={testId}
      className={cn("flex w-full items-center gap-3 px-5 py-2 text-left text-sm", onClick && "hover:bg-slate-50")}
    >
      <span
        className={cn("h-2 w-2 shrink-0 rounded-full", tone === "green" ? "bg-emerald-500" : tone === "amber" ? "bg-amber-500" : tone === "red" ? "bg-red-500" : "bg-slate-300")}
        aria-hidden
      />
      <span className="flex-1">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="w-10 text-right text-xs tabular-nums text-slate-500">{pct !== null ? `${pct} %` : ""}</span>
    </Tag>
  );
}

export function InventoryCard({ inv, onAccounts, onComputers }: { inv: IdentityInventory; onAccounts: (p: AccountPreset) => void; onComputers: (p: ComputerPreset) => void }) {
  const t = useT();
  const a = inv.accounts;
  const p = inv.computers;
  return (
    <Card className="mb-6" data-testid="idn-inventory">
      <CardHeader title={t("idn.inv.title")} subtitle={t("idn.inv.subtitle")} />
      <div className={cn("grid divide-y divide-slate-100 lg:divide-x lg:divide-y-0", p ? "lg:grid-cols-3" : "lg:grid-cols-2")}>
        <div className="py-2">
          <p className="px-5 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("idn.inv.accounts", { n: a.total })}</p>
          <Row label={t("idn.inv.active")} value={a.active} total={a.enabled} tone="green" onClick={() => onAccounts({ activity: "active" })} testId="inv-acc-active" />
          <Row label={t("idn.inv.inactive")} value={a.inactive} total={a.enabled} tone={a.inactive ? "amber" : "slate"} onClick={() => onAccounts({ activity: "inactive" })} testId="inv-acc-inactive" />
          <Row label={t("idn.inv.never")} value={a.never} total={a.enabled} tone={a.never ? "amber" : "slate"} onClick={() => onAccounts({ activity: "never" })} />
          {a.unknown > 0 && <Row label={t("idn.inv.unknown")} value={a.unknown} total={a.enabled} onClick={() => onAccounts({ activity: "unknown" })} />}
          <Row label={t("idn.inv.disabled")} value={a.disabled} onClick={() => onAccounts({ disabled: true })} />
          <p className="px-5 pt-2 text-xs text-slate-500">
            {t("idn.inv.accKinds", { user: a.user, service: a.service, guest: a.guest, priv: a.privileged, privActive: a.privilegedActive })}
          </p>
        </div>
        {p && (
          <div className="py-2">
            <p className="px-5 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("idn.inv.computers", { n: p.total })}</p>
            <Row label={t("idn.inv.active")} value={p.active} total={p.enabled} tone="green" onClick={() => onComputers({ view: "active" })} testId="inv-pc-active" />
            <Row label={t("idn.inv.inactive")} value={p.inactive} total={p.enabled} tone={p.inactive ? "amber" : "slate"} onClick={() => onComputers({ view: "stale" })} />
            <Row label={t("idn.inv.disabled")} value={p.disabled} onClick={() => onComputers({ view: "disabled" })} />
            <p className="px-5 pt-2 text-xs text-slate-500">
              {t("idn.inv.pcRoles", { dc: p.dc, server: p.server, ws: p.workstation, other: p.other, srvActive: p.serversActive, wsActive: p.workstationsActive })}
            </p>
          </div>
        )}
        <div className="py-2">
          <p className="px-5 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("idn.inv.groups", { n: inv.groups.total })}</p>
          <Row label={t("idn.inv.groupsPriv")} value={inv.groups.privileged} total={inv.groups.total} />
        </div>
      </div>
    </Card>
  );
}
