import { useT } from "@/lib/i18n";
import { PageHeader, Select } from "@/components/ui";
import { useCan } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Bell, Bot, Building2, Compass, Gauge, KeyRound, Languages, Plug, ScrollText, Settings, Shield, SlidersHorizontal, UserCog, Users, type LucideIcon } from "lucide-react";

/**
 * Administrace (v1.24.3): boční menu se skupinami podle oblasti, obsah vpravo – bez vodorovného posuvníku;
 * na úzké obrazovce rozbalovací výběr stránky.
 */
type Item = { to: string; label: string; icon: LucideIcon; show: boolean };

export function AdminLayout() {
  const can = useCan();
  const tr = useT();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const groups: { label: string; items: Item[] }[] = [
    {
      label: tr("adm.grp.access"),
      items: [
        { to: "/admin/users", label: tr("adm.tab.users"), icon: Users, show: can("admin:users") },
        { to: "/admin/groups", label: tr("adm.tab.groups"), icon: UserCog, show: can("admin:users") },
        { to: "/admin/roles", label: tr("adm.tab.roles"), icon: Shield, show: can("admin:roles", "admin:users") },
        { to: "/admin/login", label: tr("adm.tab.login"), icon: KeyRound, show: can("admin:settings") },
      ],
    },
    {
      label: tr("adm.grp.org"),
      items: [
        { to: "/admin/companies", label: tr("adm.tab.companies"), icon: Building2, show: can("admin:settings") },
        { to: "/admin/settings", label: tr("adm.tab.settings"), icon: Settings, show: can("admin:settings") },
        { to: "/admin/methodologies", label: tr("adm.tab.methodologies"), icon: SlidersHorizontal, show: can("admin:settings") },
        { to: "/admin/languages", label: tr("adm.tab.languages"), icon: Languages, show: can("admin:settings") },
      ],
    },
    {
      label: tr("adm.grp.integrations"),
      items: [
        { to: "/admin/connectors", label: tr("adm.tab.connectors"), icon: Plug, show: can("admin:settings") },
        { to: "/admin/ai", label: tr("adm.tab.ai"), icon: Bot, show: can("admin:settings", "audit_log:read") },
        { to: "/admin/notifications", label: tr("adm.tab.notifications"), icon: Bell, show: can("admin:settings") },
      ],
    },
    {
      label: tr("adm.grp.ops"),
      items: [
        { to: "/admin/setup", label: tr("adm.tab.setup"), icon: Compass, show: can("admin:settings") },
        { to: "/admin/ops", label: tr("adm.tab.ops"), icon: Gauge, show: can("admin:settings") },
        { to: "/admin/audit", label: tr("adm.tab.audit"), icon: ScrollText, show: can("audit_log:read") },
      ],
    },
  ]
    .map((g) => ({ ...g, items: g.items.filter((i) => i.show) }))
    .filter((g) => g.items.length);
  const all = groups.flatMap((g) => g.items);
  const current = all.find((i) => path === i.to || path.startsWith(`${i.to}/`));

  return (
    <>
      <PageHeader title={tr("nav.admin")} subtitle={tr("adm.subtitle")} />
      {/* úzká obrazovka: výběr stránky */}
      <div className="mb-4 lg:hidden">
        <Select aria-label={tr("nav.admin")} value={current?.to ?? ""} onChange={(e) => navigate({ to: e.target.value })}>
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.items.map((i) => (
                <option key={i.to} value={i.to}>
                  {i.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </div>
      <div className="lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-8">
        <nav aria-label={tr("nav.admin")} className="hidden lg:block" data-testid="admin-nav">
          <div className="sticky top-4 space-y-5">
            {groups.map((g) => (
              <div key={g.label} role="group" aria-label={g.label}>
                <div className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g.label}</div>
                <ul className="space-y-0.5">
                  {g.items.map((i) => {
                    const active = current?.to === i.to;
                    return (
                      <li key={i.to}>
                        <Link
                          to={i.to}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm",
                            active ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                          )}
                        >
                          <i.icon size={16} className={active ? "text-brand-600" : "text-slate-400"} aria-hidden />
                          {i.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </>
  );
}
