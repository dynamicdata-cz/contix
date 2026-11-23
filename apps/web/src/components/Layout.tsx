import { CommandPalette, openCommandPalette } from "@/components/commandPalette";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useCan, useMe, useModule } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { CompanySwitcher } from "@/components/company";
import { TopBar } from "@/components/topbar";
import { ContixMark, ContixWordmark } from "@/components/logo";
import { HelpWidget } from "@/components/help/Help";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Children, isValidElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
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
  ShieldOff, SearchCheck, ClipboardList,
  LifeBuoy,
  Swords,
  ClipboardCheck,
  GitBranch,
  LayoutDashboard, Presentation, UserLock,
  LogOut,
  Network,
  Tags,
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
  ChevronDown, Star, ListChecks, Fish, Rss, BrainCircuit, BadgeCheck, PackageCheck, Menu, Search, X, Library, MapPinned, UserCheck, FolderKanban, Milestone, Crosshair, Layers, CalendarDays } from "lucide-react";

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
  // oblíbené položky menu (v1.36): jen pohodlí v prohlížeči; registr položek plní skupiny menu při vykreslení
  const fav = useFavorites();
  const reg = useRef(new Map<string, ReactElement>()).current;
  const accessSum = useQuery({ queryKey: ["access", "summary"], queryFn: api.access.summary, enabled: (can("access:request") || can("access:manage")) && mod("access"), staleTime: 60_000 });
  const toApprove = accessSum.data?.toApprove ?? 0;
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
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-100 px-5">
          <ContixMark className="h-9 w-9 shrink-0" />
          <div className="min-w-0 flex-1">
            <ContixWordmark className="block h-[15px] w-auto" />
            <div className="truncate text-[11px] text-slate-500">{me.organizationName}</div>
          </div>
          <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 md:hidden" onClick={() => setDrawer(false)} aria-label={t("common.close")}>
            <X size={18} />
          </button>
        </div>
        {/* na počítači je výběr společnosti v horní liště */}
        <div className="sm:hidden">
          <CompanySwitcher />
        </div>
        <nav className="flex flex-1 flex-col overflow-y-auto p-3">
          <div className="order-1 space-y-0.5">
            <Link to="/" activeOptions={{ exact: true }} className={linkCls} activeProps={activeCls}>
              <LayoutDashboard size={17} /> {t("nav.overview")}
            </Link>
            {can("obligations:self") && (
              <Link to="/my" className={linkCls} activeProps={activeCls}>
                <ListTodo size={17} /> {t("nav.myObligations")}
                {pending > 0 && <span className="ml-auto rounded-full bg-red-600 px-1.5 text-[11px] font-semibold text-white">{pending}</span>}
              </Link>
            )}
            {can("obligations:self") && (
              <Link to="/calendar" className={linkCls} activeProps={activeCls} data-testid="nav-calendar">
                <CalendarDays size={17} /> {t("cal.title")}
              </Link>
            )}
            {(can("actions:read") || can("risks:read") || can("audits:read")) && (
              <Link to="/actions" className={linkCls} activeProps={activeCls}>
                <ListChecks size={17} /> {t("nav.actions")}
              </Link>
            )}
            {can("ai:use") && aiStatus.data?.enabled && (
              <Link to="/ask" className={linkCls} activeProps={activeCls}>
                <Sparkles size={17} /> {t("nav.askAi")}
              </Link>
            )}
          </div>
          <NavGroup id="manage" title={t("nav.group.manage")} reg={reg} fav={fav}>
            {can("isms:read") && mod("isms") && (
              <Link to="/isms" className={linkCls} activeProps={activeCls}>
                <Target size={17} /> {t("nav.isms")}
              </Link>
            )}
            {can("isms:read", "risks:read", "controls:read", "incidents:read", "suppliers:read", "audits:read", "bia:read", "gdpr:read") && (
              <Link to="/compliance-path" className={linkCls} activeProps={activeCls}>
                <Milestone size={17} /> {t("nav.compliancePath")}
              </Link>
            )}
            {can("assets:read", "risks:read", "controls:read", "processes:read", "suppliers:read", "actions:read", "sectests:read") && (
              <Link to="/quality" className={linkCls} activeProps={activeCls}>
                <ClipboardList size={17} /> {t("nav.quality")}
              </Link>
            )}
            {can("isms:read", "risks:read", "controls:read") && (
              <Link to="/management" className={linkCls} activeProps={activeCls}>
                <Presentation size={17} /> {t("nav.managementReport")}
              </Link>
            )}
            {me.companies.length > 1 && (
              <Link to="/group" className={linkCls} activeProps={activeCls}>
                <Network size={17} /> {t("nav.groupOverview")}
              </Link>
            )}
            {can("projects:read") && mod("projects") && (
              <Link to="/projects" className={linkCls} activeProps={activeCls}>
                <FolderKanban size={17} /> {t("nav.projects")}
              </Link>
            )}
          </NavGroup>
          <NavGroup id="records" title={t("nav.group.records")} reg={reg} fav={fav}>
            {can("org:read") && mod("organization") && (
              <Link to="/organization" className={linkCls} activeProps={activeCls}>
                <Building2 size={17} /> {t("nav.organization")}
              </Link>
            )}
            {can("processes:read") && mod("processes") && (
              <Link to="/processes" className={linkCls} activeProps={activeCls}>
                <GitBranch size={17} /> {t("nav.processes")}
              </Link>
            )}
            {can("assets:read") && mod("assets") && (
              <Link to="/assets" className={linkCls} activeProps={path.startsWith("/assets/maps") || path.startsWith("/assets/zones") ? {} : activeCls}>
                <Server size={17} /> {t("nav.assets")}
              </Link>
            )}
            {can("assets:read") && mod("assets") && (
              <Link to="/assets/maps" className={linkCls} activeProps={activeCls}>
                <MapPinned size={17} /> {t("map.title")}
              </Link>
            )}
            {can("assets:read") && mod("assets") && (
              <Link to="/assets/zones" className={linkCls} activeProps={activeCls} data-testid="nav-zones">
                <Layers size={17} /> {t("zn.title")}
              </Link>
            )}
            {can("suppliers:read") && mod("suppliers") && (
              <Link to="/suppliers" className={linkCls} activeProps={activeCls}>
                <Truck size={17} /> {t("nav.suppliers")}
              </Link>
            )}
            {(can("assets:read") || can("risks:read") || can("suppliers:read")) && (
              <Link to="/tags" className={linkCls} activeProps={activeCls}>
                <Tags size={17} /> {t("nav.tags")}
              </Link>
            )}
          </NavGroup>
          <NavGroup id="riskfind" title={t("nav.group.riskFindings")} reg={reg} fav={fav}>
            {can("risks:read") && mod("risks") && (
              <Link to="/risks" className={linkCls} activeProps={activeCls}>
                <ShieldAlert size={17} /> {t("nav.risks")}
              </Link>
            )}
            {(can("sectests:read") || can("assets:read") || can("audits:read")) && (mod("assets") || mod("sectests") || mod("audits")) && (
              <Link to="/findings" className={linkCls} activeProps={activeCls}>
                <SearchCheck size={17} /> {t("nav.findings")}
              </Link>
            )}
            {can("assets:read") && mod("vulnerabilities") && (
              <Link to="/vulnerabilities" className={linkCls} activeProps={activeCls}>
                <Bug size={17} /> {t("nav.vulnerabilities")}
              </Link>
            )}
            {can("sectests:read") && mod("sectests") && (
              <Link to="/security-tests" className={linkCls} activeProps={activeCls}>
                <Crosshair size={17} /> {t("st.title")}
              </Link>
            )}
            {(can("identity:read") || can("assets:read") || can("risks:read") || can("controls:read")) && (mod("identity") || mod("vulnerabilities") || mod("risks") || mod("controls")) && (
              <Link to="/exceptions" className={linkCls} activeProps={activeCls}>
                <ShieldOff size={17} /> {t("nav.exceptions")}
              </Link>
            )}
          </NavGroup>
          <NavGroup id="compliance" title={t("nav.group.compliance")} reg={reg} fav={fav}>
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
          <NavGroup id="operations" title={t("nav.group.operations")} reg={reg} fav={fav}>
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
            {can("identity:read") && mod("identity") && (
              <Link to="/identity" className={linkCls} activeProps={activeCls}>
                <KeyRound size={17} /> {t("nav.identity")}
              </Link>
            )}
            {(can("access:request") || can("access:manage")) && mod("access") && (
              <Link to="/access" className={linkCls} activeProps={activeCls}>
                <UserCheck size={17} /> {t("nav.access")}
                {toApprove > 0 && (
                  <span className="ml-auto rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800" title={t("acc.toApprove")}>
                    {toApprove}
                  </span>
                )}
              </Link>
            )}
            {can("assets:read") && mod("discovery") && (
              <Link to="/discovery" className={linkCls} activeProps={activeCls}>
                <Radar size={17} /> {t("nav.discovery")}
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
          <NavGroup id="regulation" title={t("nav.group.regulation")} reg={reg} fav={fav}>
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
            {can("legislation:read") && mod("legislation") && (
              <Link to="/legislation" className={linkCls} activeProps={activeCls}>
                <Scale size={17} /> {t("nav.legislation")}
              </Link>
            )}
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
          </NavGroup>
          <NavGroup id="docs" title={t("nav.group.docs")} reg={reg} fav={fav}>
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
          <NavGroup id="tools" title={t("nav.group.tools")} reg={reg} fav={fav}>
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
          <Favorites reg={reg} fav={fav} />
        </nav>
        <div className="border-t border-slate-100 px-3 py-2">
          <AboutLine />
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <TopBar onMenu={() => setDrawer(true)} pending={pending} onLogout={() => logout.mutate()} />
        <div className="app-main mx-auto max-w-7xl px-4 pb-24 pt-5 md:px-8">
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
function NavGroup({ id, title, children, reg, fav }: { id: string; title: string; children: ReactNode; reg: Map<string, ReactElement>; fav: Fav }) {
  const t = useT();
  const items = Children.toArray(children).filter(Boolean);
  for (const c of items) if (isValidElement<{ to?: string }>(c) && c.props.to) reg.set(c.props.to, c);
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
    <div className="order-3 mt-4">
      <button onClick={toggle} className="flex w-full items-center gap-2 px-3 pb-1 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-600" aria-expanded={shown} title={title}>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <ChevronDown size={13} className={cn("shrink-0 transition-transform", !shown && "-rotate-90")} />
      </button>
      {/* sbalená skupina zůstává v DOM (skrytá) – rychlé hledání z ní čte stránky */}
      <div className="space-y-0.5" hidden={!shown}>
        {items.map((c, i) => {
          const to = isValidElement<{ to?: string }>(c) ? c.props.to : undefined;
          const on = !!to && fav.list.includes(to);
          return (
            <div key={i} className="group/nav relative">
              {c}
              {to && (
                <button
                  type="button"
                  onClick={() => fav.toggle(to)}
                  className={cn(
                    "absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-white hover:text-amber-500 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300",
                    on ? "text-amber-500 opacity-0 group-hover/nav:opacity-100" : "opacity-0 group-hover/nav:opacity-100",
                  )}
                  aria-label={on ? t("nav.unpin") : t("nav.pin")}
                  title={on ? t("nav.unpin") : t("nav.pin")}
                >
                  <Star size={13} fill={on ? "currentColor" : "none"} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type Fav = { list: string[]; toggle: (to: string) => void };
const FAV_KEY = "contix.nav.favorites";
function useFavorites(): Fav {
  const [list, setList] = useState<string[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]");
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 12) : [];
    } catch {
      return [];
    }
  });
  const toggle = (to: string) => {
    const next = list.includes(to) ? list.filter((x) => x !== to) : [...list, to].slice(-12);
    setList(next);
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(next));
    } catch {
      /* úložiště nedostupné */
    }
  };
  return { list, toggle };
}

/** Oblíbené (připnuté) položky – vykreslují se za skupinami (registr už je naplněný), zobrazí se nad nimi (CSS order). */
function Favorites({ reg, fav }: { reg: Map<string, ReactElement>; fav: Fav }) {
  const t = useT();
  const items = fav.list.map((to) => reg.get(to)).filter((x): x is ReactElement => !!x);
  if (!items.length) return null;
  return (
    <div className="order-2 mt-4" data-testid="nav-favorites">
      <div className="flex items-center gap-1.5 px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        <Star size={11} /> {t("nav.favorites")}
      </div>
      <div className="space-y-0.5">
        {items.map((c, i) => (
          <div key={i} className="group/nav relative">
            {c}
            <button
              type="button"
              onClick={() => fav.toggle((c.props as { to: string }).to)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-amber-500 opacity-0 hover:bg-white focus-visible:opacity-100 group-hover/nav:opacity-100"
              aria-label={t("nav.unpin")}
              title={t("nav.unpin")}
            >
              <Star size={13} fill="currentColor" />
            </button>
          </div>
        ))}
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
