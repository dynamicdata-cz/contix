import { CommandPalette, openCommandPalette } from "@/components/commandPalette";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useCan, useMe, useModule } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { ActiveCompanyBar, CompanySwitcher } from "@/components/company";
import { HelpWidget } from "@/components/help/Help";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from "react";
import { frameworkRegistryVersion, registerCustomFrameworks } from "@contix/shared";
import { Activity, ShieldCheck,
  BookText,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  ListTodo,
  Bug,
  Building2,
  FileCheck2,
  Grid3x3,
  ShieldOff,
  LifeBuoy,
  Swords,
  ClipboardCheck,
  GitBranch,
  LayoutDashboard, Presentation, UserLock,
  LogOut,
  Network,
  Radar,
  Server,
  Settings,
  ShieldAlert,
  Sparkles,
  Siren,
  Target,
  Truck,
  UserRound,
  KeyRound,
  Scale,
  ChevronDown, ListChecks, Fish, Rss, BrainCircuit, BadgeCheck, PackageCheck, Menu, Search, X, Library } from "lucide-react";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const linkCls = "flex items-center gap-3 rounded-lg px-3 py-[7px] text-[13.5px] text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300";
const activeCls = { className: "nav-active !bg-brand-50 !text-brand-700 font-medium" };

export function Layout() {
  const path = useRouterState({ select: (st) => st.location.pathname });
  const me = useMe();
  const can = useCan();
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: api.auth.logout,
    onSuccess: () => {
      // nejdřív přepnout na přihlašovací obrazovku, pak zahodit data předchozího uživatele
      // (samotné qc.clear() aktivní dotaz /me znovu nenačte – uživatel zůstal „přihlášený“)
      qc.setQueryData(["me"], null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    },
  });
  const mod = useModule();
  const t = useT();
  const obligations = useQuery({ queryKey: ["obligations", "mine"], queryFn: api.notifications.mine, enabled: can("obligations:self"), staleTime: 60_000 });
  const pending = (obligations.data ?? []).filter((o) => o.urgency !== "later").length;
  // neposouzená varování NÚKIB (ADR-087) – počet u položky menu
  const info = useQuery({ queryKey: ["infoservice"], queryFn: api.infoService.get, enabled: can("legislation:read") && mod("legislation"), staleTime: 300_000 });
  const warnings = info.data?.counts.warningsOpen ?? 0;
  const aiStatus = useQuery({ queryKey: ["ai", "status"], queryFn: api.ai.status, enabled: can("ai:use"), staleTime: 60_000 });
  // mobilní menu – zavřít po přechodu na jinou stránku
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [path]);
  const showAdmin = can("admin:users", "admin:roles", "admin:settings", "audit_log:read");
  // vlastní rámce z knihovny do sdíleného registru (výběry požadavků, SoA, pokrytí…) – ADR-079
  const fwCatalog = useQuery({ queryKey: ["frameworks", "catalog"], queryFn: api.frameworks.catalog, staleTime: 5 * 60_000 });
  const fwRegistered = useRef<unknown>(null);
  if (fwCatalog.data && fwRegistered.current !== fwCatalog.data) {
    registerCustomFrameworks(fwCatalog.data);
    fwRegistered.current = fwCatalog.data;
  }

  return (
    <div className="flex h-full">
      {/* mobilní menu (v1.06): stejný panel jako na počítači, vysouvací */}
      {drawer && <div className="fixed inset-0 z-30 bg-slate-900/40 md:hidden" onClick={() => setDrawer(false)} aria-hidden />}
      <aside
        className={cn(
          "app-sidebar w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:static md:flex",
          drawer ? "fixed inset-y-0 left-0 z-40 flex shadow-xl" : "hidden",
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b border-slate-100 px-5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white shadow-sm shadow-brand-600/30">C</div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold leading-tight">CONTIX</div>
            <div className="truncate text-[11px] text-slate-500">{me.organizationName}</div>
          </div>
          <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 md:hidden" onClick={() => setDrawer(false)} aria-label={t("common.close")}>
            <X size={18} />
          </button>
        </div>
        <button
          type="button"
          onClick={openCommandPalette}
          className="mx-3 mt-3 flex items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 text-left text-sm text-slate-500 hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          <Search size={15} /> <span className="flex-1">{t("pal.button")}</span>
          <kbd className="rounded border border-slate-200 px-1 text-[10px] text-slate-400">{isMac ? "⌘K" : "Ctrl K"}</kbd>
        </button>
        <CompanySwitcher />
        <nav className="flex-1 overflow-y-auto p-3">
          <div className="space-y-0.5">
            <Link to="/" activeOptions={{ exact: true }} className={linkCls} activeProps={activeCls}>
              <LayoutDashboard size={17} /> {t("nav.overview")}
            </Link>
            {can("obligations:self") && (
              <Link to="/my" className={linkCls} activeProps={activeCls}>
                <ListTodo size={17} /> {t("nav.myObligations")}
                {pending > 0 && <span className="ml-auto rounded-full bg-red-600 px-1.5 text-[11px] font-semibold text-white">{pending}</span>}
              </Link>
            )}
            {can("isms:read", "risks:read", "controls:read") && (
              <Link to="/management" className={linkCls} activeProps={activeCls}>
                <Presentation size={17} /> {t("nav.managementReport")}
              </Link>
            )}
            {can("legislation:read") && mod("legislation") && (
              <Link to="/infoservice" className={linkCls} activeProps={activeCls}>
                <Rss size={17} /> {t("nav.infoservice")}
                {warnings > 0 && (
                  <span className="ml-auto rounded-full bg-red-600 px-1.5 text-[11px] font-semibold text-white" title={t("ifs.kpi.warnings")}>
                    {warnings}
                  </span>
                )}
              </Link>
            )}
            {can("ai:use") && aiStatus.data?.enabled && (
              <Link to="/ask" className={linkCls} activeProps={activeCls}>
                <Sparkles size={17} /> {t("nav.askAi")}
              </Link>
            )}
            {me.companies.length > 1 && (
              <Link to="/group" className={linkCls} activeProps={activeCls}>
                <Network size={17} /> {t("nav.groupOverview")}
              </Link>
            )}
          </div>
          <NavGroup id="governance" title={t("nav.group.governance")}>
            {can("isms:read") && mod("isms") && (
              <Link to="/isms" className={linkCls} activeProps={activeCls}>
                <Target size={17} /> {t("nav.isms")}
              </Link>
            )}
            {can("risks:read") && mod("risks") && (
              <Link to="/risks" className={linkCls} activeProps={activeCls}>
                <ShieldAlert size={17} /> {t("nav.risks")}
              </Link>
            )}
            {(can("identity:read") || can("assets:read") || can("risks:read") || can("controls:read")) && (mod("identity") || mod("vulnerabilities") || mod("risks") || mod("controls")) && (
              <Link to="/exceptions" className={linkCls} activeProps={activeCls}>
                <ShieldOff size={17} /> {t("nav.exceptions")}
              </Link>
            )}
            {(can("actions:read") || can("risks:read") || can("audits:read")) && (
              <Link to="/actions" className={linkCls} activeProps={activeCls}>
                <ListChecks size={17} /> {t("nav.actions")}
              </Link>
            )}
          </NavGroup>
          <NavGroup id="compliance" title={t("nav.group.compliance")}>
            {can("controls:read") && mod("controls") && (
              <Link to="/controls" className={linkCls} activeProps={path.startsWith("/controls/coverage") || path.startsWith("/controls/monitoring") ? {} : activeCls}>
                <FileCheck2 size={17} /> {t("nav.controls")}
              </Link>
            )}
            {can("controls:read") && mod("controls") && (
              <Link to="/controls/coverage" className={linkCls} activeProps={activeCls}>
                <Grid3x3 size={17} /> {t("nav.coverage")}
              </Link>
            )}
            {can("controls:read") && mod("controls") && (
              <Link to="/controls/monitoring" className={linkCls} activeProps={activeCls}>
                <Activity size={17} /> {t("mon.title")}
              </Link>
            )}
            {can("audits:read") && mod("audits") && (
              <Link to="/audits" className={linkCls} activeProps={activeCls}>
                <ClipboardCheck size={17} /> {t("nav.audits")}
              </Link>
            )}
            {can("audits:read") && mod("soc2") && (
              <Link to="/soc2" className={linkCls} activeProps={activeCls}>
                <BadgeCheck size={17} /> {t("nav.soc2")}
              </Link>
            )}
            {can("trust:read") && mod("trust") && (
              <Link to="/trust" className={linkCls} activeProps={activeCls}>
                <ShieldCheck size={17} /> {t("nav.trust")}
              </Link>
            )}
            {can("audits:external") && !can("audits:read") && mod("audits") && (
              <Link to="/audit-portal" className={linkCls} activeProps={activeCls}>
                <ClipboardCheck size={17} /> {t("nav.auditPortal")}
              </Link>
            )}
          </NavGroup>
          <NavGroup id="regulation" title={t("nav.group.regulation")}>
            {can("gdpr:read") && mod("gdpr") && (
              <Link to="/gdpr" className={linkCls} activeProps={activeCls}>
                <UserLock size={17} /> {t("nav.gdpr")}
              </Link>
            )}
            {can("aiact:read") && mod("aiact") && (
              <Link to="/aiact" className={linkCls} activeProps={activeCls}>
                <BrainCircuit size={17} /> {t("nav.aiact")}
              </Link>
            )}
            {can("cra:read") && mod("cra") && (
              <Link to="/cra" className={linkCls} activeProps={activeCls}>
                <PackageCheck size={17} /> {t("nav.cra")}
              </Link>
            )}
            {can("legislation:read") && mod("legislation") && (
              <Link to="/legislation" className={linkCls} activeProps={activeCls}>
                <Scale size={17} /> {t("nav.legislation")}
              </Link>
            )}
          </NavGroup>
          <NavGroup id="operations" title={t("nav.group.operations")}>
            {mod("incidents") && (can("incidents:read") || can("incidents:report")) && (
              <Link to={can("incidents:read") ? "/incidents" : "/incidents/report"} className={linkCls} activeProps={activeCls}>
                <Siren size={17} /> {can("incidents:read") ? t("nav.incidents") : t("nav.reportEvent")}
              </Link>
            )}
            {mod("soc") && can("incidents:report") && (
              <Link to="/phishing" className={linkCls} activeProps={activeCls}>
                <Fish size={17} /> {t("nav.reportPhishing")}
              </Link>
            )}
            {can("soc:read") && mod("soc") && (
              <Link to="/soc" className={linkCls} activeProps={activeCls}>
                <Radar size={17} /> {t("nav.soc")}
              </Link>
            )}
            {can("assets:read") && mod("vulnerabilities") && (
              <Link to="/vulnerabilities" className={linkCls} activeProps={activeCls}>
                <Bug size={17} /> {t("nav.vulnerabilities")}
              </Link>
            )}
            {can("identity:read") && mod("identity") && (
              <Link to="/identity" className={linkCls} activeProps={activeCls}>
                <KeyRound size={17} /> {t("nav.identity")}
              </Link>
            )}
            {can("bia:read") && mod("continuity") && (
              <Link to="/bia" className={linkCls} activeProps={activeCls}>
                <LifeBuoy size={17} /> {t("nav.continuity")}
              </Link>
            )}
            {can("bia:read") && mod("continuity") && (
              <Link to="/continuity/exercises" className={linkCls} activeProps={activeCls}>
                <Swords size={17} /> {t("nav.exercises")}
              </Link>
            )}
          </NavGroup>
          <NavGroup id="records" title={t("nav.group.records")}>
            {can("assets:read") && mod("assets") && (
              <Link to="/assets" className={linkCls} activeProps={activeCls}>
                <Server size={17} /> {t("nav.assets")}
              </Link>
            )}
            {can("processes:read") && mod("processes") && (
              <Link to="/processes" className={linkCls} activeProps={activeCls}>
                <GitBranch size={17} /> {t("nav.processes")}
              </Link>
            )}
            {can("suppliers:read") && mod("suppliers") && (
              <Link to="/suppliers" className={linkCls} activeProps={activeCls}>
                <Truck size={17} /> {t("nav.suppliers")}
              </Link>
            )}
            {can("org:read") && mod("organization") && (
              <Link to="/organization" className={linkCls} activeProps={activeCls}>
                <Building2 size={17} /> {t("nav.organization")}
              </Link>
            )}
          </NavGroup>
          <NavGroup id="docs" title={t("nav.group.docs")}>
            {can("obligations:self") && mod("policies") && (
              <Link to="/docs" className={linkCls} activeProps={activeCls}>
                <FileText size={17} /> {t("nav.documents")}
              </Link>
            )}
            {can("policies:read") && mod("policies") && (
              <Link to="/policies" className={linkCls} activeProps={activeCls}>
                <BookText size={17} /> {t("nav.policies")}
              </Link>
            )}
            {can("knowledge:read") && mod("knowledge") && (
              <Link to="/knowledge" className={linkCls} activeProps={activeCls}>
                <Library size={17} /> {t("nav.knowledge")}
              </Link>
            )}
            {can("awareness:read") && mod("awareness") && (
              <Link to="/awareness" className={linkCls} activeProps={activeCls}>
                <GraduationCap size={17} /> {t("nav.awareness")}
              </Link>
            )}
          </NavGroup>
          <NavGroup id="tools" title={t("nav.group.tools")}>
            {can("assets:read") && mod("discovery") && (
              <Link to="/discovery" className={linkCls} activeProps={activeCls}>
                <Radar size={17} /> {t("nav.discovery")}
              </Link>
            )}
            {can("assets:write", "risks:write", "processes:write", "controls:write", "suppliers:write") && (
              <Link to="/import" className={linkCls} activeProps={activeCls}>
                <FileSpreadsheet size={17} /> {t("nav.import")}
              </Link>
            )}
            {showAdmin && (
              <Link to="/admin" className={linkCls} activeProps={activeCls}>
                <Settings size={17} /> {t("nav.admin")}
              </Link>
            )}
          </NavGroup>
        </nav>
        <div className="border-t border-slate-100 p-3">
          <Link to="/profile" className={cn(linkCls, "items-start")} activeProps={activeCls}>
            <UserRound size={17} className="mt-0.5 shrink-0" />
            <span className="min-w-0">
              <span className="block truncate font-medium text-slate-800">{me.user.displayName}</span>
              <span className="block truncate text-xs text-slate-500">{me.user.roles.map((r) => r.name).join(", ") || t("nav.noRole")}</span>
            </span>
          </Link>
          <button className={cn(linkCls, "w-full")} onClick={() => logout.mutate()}>
            <LogOut size={17} /> {t("nav.logout")}
          </button>
          <AboutLine />
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-slate-200 bg-white px-3 md:hidden">
          <button type="button" className="rounded p-1.5 text-slate-600 hover:bg-slate-100" onClick={() => setDrawer(true)} aria-label={t("nav.menu")} aria-expanded={drawer}>
            <Menu size={20} />
          </button>
          <div className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-xs font-bold text-white">C</div>
          <span className="flex-1 font-semibold">CONTIX</span>
          <button type="button" className="rounded p-1.5 text-slate-600 hover:bg-slate-100" onClick={openCommandPalette} aria-label={t("pal.title")}>
            <Search size={19} />
          </button>
        </div>
        <ActiveCompanyBar />
        <div className="mx-auto max-w-7xl px-4 pb-24 pt-6 md:px-8">
          <Breadcrumbs />
          {/* po načtení vlastních rámců se stránka vykreslí znovu (memoizované seznamy požadavků) */}
          {fwCatalog.isPending ? null : <Outlet key={frameworkRegistryVersion} />}
        </div>
      </main>
      <HelpWidget />
      <CommandPalette aiEnabled={!!aiStatus.data?.enabled} />
    </div>
  );
}

/** Sbalitelná skupina menu; prázdná (bez oprávnění / modulů) se nezobrazí. Stav sbalení si pamatuje prohlížeč. */
function NavGroup({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const items = Children.toArray(children).filter(Boolean);
  const key = `contix.nav.${id}`;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== "0";
    } catch {
      return true;
    }
  });
  const path = useRouterState({ select: (st) => st.location.pathname });
  const hrefs = items.map((c) => (isValidElement<{ to?: string }>(c) ? c.props.to : undefined)).filter((x): x is string => !!x);
  const containsActive = hrefs.some((h) => path === h || path.startsWith(`${h}/`));
  if (!items.length) return null;
  const shown = open || containsActive;
  const toggle = () => {
    setOpen(!shown);
    try {
      localStorage.setItem(key, shown ? "0" : "1");
    } catch {
      /* úložiště nedostupné */
    }
  };
  return (
    <div className="mt-4">
      <button onClick={toggle} className="flex w-full items-center gap-2 px-3 pb-1 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-600" aria-expanded={shown} title={title}>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <ChevronDown size={13} className={cn("shrink-0 transition-transform", !shown && "-rotate-90")} />
      </button>
      {/* sbalená skupina zůstává v DOM (skrytá) – rychlé hledání z ní čte stránky */}
      <div className="space-y-0.5" hidden={!shown}>
        {items}
      </div>
    </div>
  );
}

/** Verze, licence a odkaz na zdrojový kód (AGPL-3.0 čl. 13, v1.15). */
function AboutLine() {
  const t = useT();
  const q = useQuery({ queryKey: ["health"], queryFn: api.health, staleTime: Infinity, retry: false });
  if (!q.data) return null;
  return (
    <p className="mt-1 px-3 text-[11px] leading-snug text-slate-400" data-testid="about-line">
      CONTIX {q.data.version} · {t("about.license", { license: q.data.license })}
      {q.data.sourceUrl && (
        <>
          {" · "}
          <a href={q.data.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-600">
            {t("about.source")}
          </a>
        </>
      )}
    </p>
  );
}
