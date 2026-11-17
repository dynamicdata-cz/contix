/**
 * Horní lišta (v1.36, ADR-133): společnost, hledání a příkazy (Ctrl K), Moje práce, uživatel.
 * Nahrazuje pruh „Pracujete ve společnosti“, výběr společnosti a uživatele v bočním menu.
 */
import { ContixMark } from "@/components/logo";
import { openCommandPalette } from "@/components/commandPalette";
import { useSwitchCompany } from "@/components/company";
import { DropdownMenu, type MenuItem } from "@/components/ui/menu";
import { useMe } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { getTopbar, TOPBAR_EVENT } from "@/lib/theme";
import { FRAMEWORKS, GROUP_SCOPE, type TopbarColor } from "@contix/shared";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell, Building, Check, ChevronDown, LogOut, Menu, Network, Search, UserRound } from "lucide-react";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0]!.toUpperCase())
      .slice(0, 2)
      .join("") || "?"
  );
}

/** Barva lišty: nastavení aktivní společnosti, jinak volba uživatele (v1.45, ADR-142). */
function useTopbarColor(): TopbarColor {
  const me = useMe();
  const [mine, setMine] = useState<TopbarColor>(getTopbar);
  useEffect(() => {
    const on = () => setMine(getTopbar());
    window.addEventListener(TOPBAR_EVENT, on);
    return () => window.removeEventListener(TOPBAR_EVENT, on);
  }, []);
  const active = me.companies.find((c) => c.id === me.activeCompanyId);
  return active?.topbarColor ?? mine;
}

export function TopBar({ onMenu, pending, onLogout }: { onMenu: () => void; pending: number; onLogout: () => void }) {
  const t = useT();
  const me = useMe();
  const color = useTopbarColor();
  const colored = color !== "default";
  return (
    <header
      className={cn("app-topbar sticky top-0 z-30 flex h-14 items-center gap-2 px-3 md:gap-3 md:px-6", colored ? `topbar-colored topbar-c-${color}` : "border-b border-slate-200 bg-white/95 backdrop-blur")}
      data-testid="topbar"
      data-topbar={color}
    >
      <button type="button" className="tb-fg tb-btn rounded-md p-2 text-slate-600 hover:bg-slate-100 md:hidden" onClick={onMenu} aria-label={t("nav.menu")}>
        <Menu size={20} />
      </button>
      <ContixMark className="h-8 w-8 shrink-0 md:hidden" />
      <CompanyMenu />
      <button
        type="button"
        onClick={openCommandPalette}
        className="tb-field ml-auto flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm text-slate-500 hover:border-slate-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 md:ml-0 md:w-full md:max-w-md"
        aria-label={t("pal.button")}
      >
        <Search size={16} className="shrink-0" />
        <span className="hidden flex-1 truncate md:inline">{t("pal.button")}</span>
        <kbd className="hidden rounded border border-slate-200 bg-white px-1.5 text-[10px] text-slate-400 md:inline">{isMac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      <div className="flex items-center gap-1 md:ml-auto">
        <Link to="/my" className="tb-fg tb-btn relative rounded-lg p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300" aria-label={t("top.myWork", { n: pending })} title={t("nav.myObligations")}>
          <Bell size={19} />
          {pending > 0 && <span className="absolute right-1 top-1 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] font-semibold leading-4 text-white">{pending > 99 ? "99+" : pending}</span>}
        </Link>
        <DropdownMenu
          label={t("top.userMenu")}
          buttonClassName="tb-fg tb-btn flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          button={
            <>
              <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">{initials(me.user.displayName)}</span>
              <span className="hidden max-w-40 truncate font-medium lg:inline">{me.user.displayName}</span>
              <ChevronDown size={14} className="hidden text-slate-400 lg:inline" />
            </>
          }
          header={
            <div className="border-b border-slate-100 px-2.5 pb-2 pt-1.5">
              <div className="truncate text-sm font-semibold text-slate-900">{me.user.displayName}</div>
              <div className="truncate text-xs text-slate-500">{me.user.roles.map((r) => r.name).join(", ") || t("nav.noRole")}</div>
            </div>
          }
          items={[
            { label: t("top.profile"), icon: <UserRound size={16} />, to: "/profile" },
            "separator",
            { label: t("nav.logout"), icon: <LogOut size={16} />, onClick: onLogout, danger: true },
          ]}
        />
      </div>
    </header>
  );
}

/** Výběr společnosti; u jedné společnosti jen její název. */
function CompanyMenu() {
  const t = useT();
  const me = useMe();
  const switchTo = useSwitchCompany();
  const active = me.companies.find((c) => c.id === me.activeCompanyId) ?? null;
  const many = me.companies.length > 1 || me.canGroupView;
  const regime = (c: NonNullable<typeof active>) =>
    c.pack === "generic"
      ? (FRAMEWORKS.find((x) => x.id === c.primaryFramework)?.shortName ?? t("company.regime.none"))
      : c.regime === "higher"
        ? t("company.regime.higher")
        : c.regime === "lower"
          ? t("company.regime.lower")
          : t("company.regime.none");
  const name = active ? active.name : me.companies.length > 1 ? t("company.wholeGroup") : me.organizationName;
  const sub = active ? `${regime(active)}${active.doraEntity ? " · DORA" : ""}` : me.companies.length > 1 ? t("top.allCompanies", { n: me.companies.length }) : null;
  const body = (
    <>
      <span className={cn("h-2 w-2 shrink-0 rounded-full", active ? "bg-emerald-600" : "bg-brand-600")} aria-hidden />
      <span className="min-w-0 text-left">
        <span className="tb-fg block max-w-[12rem] truncate text-sm font-semibold leading-tight text-slate-900 lg:max-w-[16rem]">{name}</span>
        {sub && <span className="tb-muted block max-w-[12rem] truncate text-[11px] leading-tight text-slate-500 lg:max-w-[16rem]">{sub}</span>}
      </span>
    </>
  );
  if (!many) return <div className="hidden items-center gap-2 sm:flex">{body}</div>;
  const items: MenuItem[] = [
    ...(me.canGroupView && me.companies.length > 1
      ? [{ label: t("company.wholeGroup"), icon: <Network size={16} className="text-brand-600" />, onClick: () => switchTo(GROUP_SCOPE), hint: !active ? <Check size={15} className="text-brand-600" /> : undefined }, "separator" as const]
      : []),
    ...me.companies.map((c) => ({
      label: (
        <span style={{ paddingLeft: `${c.depth * 12}px` }} className="block">
          <span className="block truncate">{c.name}</span>
          <span className="block text-[11px] text-slate-500">
            {c.kind === "holding" ? t("company.kind.holding") : t("company.kind.company")} · {regime(c)}
          </span>
        </span>
      ),
      icon: c.kind === "holding" ? <Network size={16} className="text-slate-400" /> : <Building size={16} className="text-slate-400" />,
      onClick: () => switchTo(c.id),
      hint: c.id === me.activeCompanyId ? <Check size={15} className="text-brand-600" /> : undefined,
    })),
  ];
  return (
    <DropdownMenu
      label={t("company.active")}
      align="start"
      className="hidden sm:block"
      buttonClassName="tb-field flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
      button={
        <>
          {body}
          <ChevronDown size={14} className="tb-muted shrink-0 text-slate-400" />
        </>
      }
      header={!active && me.companies.length > 1 ? <p className="px-2.5 pb-2 pt-1 text-xs text-slate-500">{t("company.newRecordsInto", { name: me.companies.find((c) => c.id === me.homeCompanyId)?.name ?? t("company.homeCompany") })}</p> : undefined}
      items={items}
    />
  );
}
