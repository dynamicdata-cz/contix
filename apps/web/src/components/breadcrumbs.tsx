/** Drobečková navigace a tlačítko Zpět nad obsahem stránky – kde se uživatel nachází a cesta o úroveň výš. */
import { useT } from "@/lib/i18n";
import { usePageTitle } from "@/lib/pageTitle";
import type { MsgKey } from "@contix/shared";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight } from "lucide-react";

/** Známé stránky (cesta → klíč popisku). Detail záznamu pod nimi se zobrazí jako „Detail“. */
const PAGES: [string, MsgKey][] = [
  ["/my", "nav.myObligations"],
  ["/calendar", "cal.title"],
  ["/management", "nav.managementReport"],
  ["/compliance-path", "nav.compliancePath"],
  ["/compliance-path/audit", "gd.audit.title"],
  ["/ask", "nav.askAi"],
  ["/group", "nav.groupOverview"],
  ["/tags", "nav.tags"],
  ["/suppliers/locations", "loc.title"],
  ["/isms", "nav.isms"],
  ["/risks", "nav.risks"],
  ["/risks/scenarios", "rsc.title"],
  ["/risks/modeling", "tm.title"],
  ["/risks/appetite", "rap.title"],
  ["/controls", "nav.controls"],
  ["/controls/coverage", "nav.coverage"],
  ["/controls/library", "fwl.title"],
  ["/controls/monitoring", "mon.title"],
  ["/controls/assurance", "crumb.assurance"],
  ["/continuity/plans", "crumb.plans"],
  ["/isms/changes", "crumb.ismsChanges"],
  ["/risks/cycles", "cyc.pravidelneHodnoceniRizik"],
  ["/bia/cycles", "cyc.pravidelnaAnalyzaDopadu"],
  ["/exceptions", "nav.exceptions"],
  ["/findings", "nav.findings"],
  ["/quality", "nav.quality"],
  ["/actions", "nav.actions"],
  ["/audit-portal", "nav.auditPortal"],
  ["/audits", "nav.audits"],
  ["/phishing", "nav.reportPhishing"],
  ["/soc", "nav.soc"],
  ["/bia", "nav.continuity"],
  ["/continuity/exercises", "nav.exercises"],
  ["/assets", "nav.assets"],
  ["/assets/maps", "map.title"],
  ["/assets/zones", "zn.title"],
  ["/assets/locations", "prem.title"],
  ["/vulnerabilities", "nav.vulnerabilities"],
  ["/processes", "nav.processes"],
  ["/incidents", "nav.incidents"],
  ["/suppliers", "nav.suppliers"],
  ["/identity", "nav.identity"],
  ["/access", "nav.access"],
  ["/projects", "nav.projects"],
  ["/gdpr", "nav.gdpr"],
  ["/aiact", "nav.aiact"],
  ["/soc2", "nav.soc2"],
  ["/trust", "nav.trust"],
  ["/cra", "nav.cra"],
  ["/organization", "nav.organization"],
  ["/docs", "nav.documents"],
  ["/knowledge", "nav.knowledge"],
  ["/policies", "nav.policies"],
  ["/infoservice", "nav.infoservice"],
  ["/legislation", "nav.legislation"],
  ["/awareness", "nav.awareness"],
  ["/discovery", "nav.discovery"],
  ["/discovery/map", "imap.open"],
  ["/security-tests", "st.title"],
  ["/import", "nav.import"],
  ["/profile", "profile.title"],
  ["/admin", "nav.admin"],
  ["/admin/setup", "adm.tab.setup"],
  ["/setup-wizard", "wiz.title"],
  ["/admin/users", "adm.tab.users"],
  ["/admin/groups", "adm.tab.groups"],
  ["/admin/roles", "adm.tab.roles"],
  ["/admin/companies", "adm.tab.companies"],
  ["/admin/settings", "adm.tab.settings"],
  ["/admin/login", "adm.tab.login"],
  ["/admin/methodologies", "adm.tab.methodologies"],
  ["/admin/notifications", "adm.tab.notifications"],
  ["/admin/connectors", "adm.tab.connectors"],
  ["/admin/ai", "adm.tab.ai"],
  ["/admin/ops", "adm.tab.ops"],
  ["/admin/languages", "adm.tab.languages"],
  ["/admin/audit", "adm.tab.audit"],
];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** Stránky, jejichž nadřazená sekce neodpovídá adrese (detail testu a důkazu patří pod Testy a důkazy). */
const PARENTS: [RegExp, string][] = [[/^\/controls\/(tests|evidence)\//, "/controls/assurance"]];

/** Cesta k aktuální stránce: Přehled › sekce › podstránka › Detail (název stránky doplní `Breadcrumbs`). */
export function crumbsFor(path: string): { to: string | null; key: MsgKey }[] {
  if (path === "/" || path === "") return [];
  const logical = PARENTS.find(([re]) => re.test(path));
  const hits = PAGES.filter(([p]) => under(path, p) || (logical && under(logical[1], p))).sort((a, b) => a[0].length - b[0].length);
  const out: { to: string | null; key: MsgKey }[] = [{ to: "/", key: "nav.overview" }, ...hits.map(([to, key]) => ({ to, key }))];
  const last = hits.at(-1)?.[0];
  if (!last || path.replace(/\/$/, "") !== last) out.push({ to: null, key: "crumb.detail" });
  return out;
}

export function Breadcrumbs() {
  const t = useT();
  const router = useRouter();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const title = usePageTitle();
  const items = crumbsFor(path);
  if (!items.length) return null;
  const parent = [...items].reverse().find((x, i) => i > 0 && x.to)?.to ?? "/";
  const back = () => {
    // zpět v historii, jen když předchozí stránka byla v CONTIXu; jinak o úroveň výš
    if (router.history.canGoBack()) router.history.back();
    else router.navigate({ to: parent });
  };
  return (
    <nav aria-label={t("crumb.nav")} className="mb-3 flex flex-wrap items-center gap-1.5 text-[13px] text-slate-500" data-testid="breadcrumbs">
      <button type="button" onClick={back} className="-ml-1.5 mr-1 inline-flex items-center rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300" title={t("crumb.back")} aria-label={t("crumb.back")}>
        <ArrowLeft size={15} />
      </button>
      {items.map((x, i) => (
        <span key={`${x.key}-${i}`} className="inline-flex items-center gap-1.5">
          {i > 0 && <ChevronRight size={13} className="text-slate-300" />}
          {x.to && i < items.length - 1 ? (
            <Link to={x.to} className="hover:text-brand-700 hover:underline">
              {t(x.key)}
            </Link>
          ) : (
            <span className="max-w-[28rem] truncate font-medium text-slate-700" aria-current="page" title={x.key === "crumb.detail" && title ? title : undefined}>
              {x.key === "crumb.detail" && title ? title : t(x.key)}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
