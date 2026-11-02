/** Drobečková navigace a tlačítko Zpět nad obsahem stránky – kde se uživatel nachází a cesta o úroveň výš. */
import { useT } from "@/lib/i18n";
import type { MsgKey } from "@contix/shared";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight } from "lucide-react";

/** Známé stránky (cesta → klíč popisku). Detail záznamu pod nimi se zobrazí jako „Detail“. */
const PAGES: [string, MsgKey][] = [
  ["/my", "nav.myObligations"],
  ["/management", "nav.managementReport"],
  ["/ask", "nav.askAi"],
  ["/group", "nav.groupOverview"],
  ["/isms", "nav.isms"],
  ["/risks", "nav.risks"],
  ["/risks/scenarios", "rsc.title"],
  ["/risks/appetite", "rap.title"],
  ["/controls", "nav.controls"],
  ["/controls/coverage", "nav.coverage"],
  ["/controls/library", "fwl.title"],
  ["/controls/monitoring", "mon.title"],
  ["/exceptions", "nav.exceptions"],
  ["/actions", "nav.actions"],
  ["/audit-portal", "nav.auditPortal"],
  ["/audits", "nav.audits"],
  ["/phishing", "nav.reportPhishing"],
  ["/soc", "nav.soc"],
  ["/bia", "nav.continuity"],
  ["/continuity/exercises", "nav.exercises"],
  ["/assets", "nav.assets"],
  ["/vulnerabilities", "nav.vulnerabilities"],
  ["/processes", "nav.processes"],
  ["/suppliers", "nav.suppliers"],
  ["/identity", "nav.identity"],
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
  ["/import", "nav.import"],
  ["/profile", "profile.title"],
  ["/admin", "nav.admin"],
  ["/admin/setup", "adm.tab.setup"],
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

/** Cesta k aktuální stránce: Přehled › sekce › podstránka › Detail. */
export function crumbsFor(path: string): { to: string | null; key: MsgKey }[] {
  if (path === "/" || path === "") return [];
  const hits = PAGES.filter(([p]) => under(path, p)).sort((a, b) => a[0].length - b[0].length);
  const out: { to: string | null; key: MsgKey }[] = [{ to: "/", key: "nav.overview" }, ...hits.map(([to, key]) => ({ to, key }))];
  const last = hits.at(-1)?.[0];
  if (!last || path.replace(/\/$/, "") !== last) out.push({ to: null, key: "crumb.detail" });
  return out;
}

export function Breadcrumbs() {
  const t = useT();
  const router = useRouter();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const items = crumbsFor(path);
  if (!items.length) return null;
  const parent = [...items].reverse().find((x, i) => i > 0 && x.to)?.to ?? "/";
  const back = () => {
    // zpět v historii, jen když předchozí stránka byla v CONTIXu; jinak o úroveň výš
    if (router.history.canGoBack()) router.history.back();
    else router.navigate({ to: parent });
  };
  return (
    <nav aria-label={t("crumb.nav")} className="mb-4 flex flex-wrap items-center gap-1.5 text-sm text-slate-500" data-testid="breadcrumbs">
      <button type="button" onClick={back} className="mr-2 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50" title={t("crumb.back")}>
        <ArrowLeft size={14} /> {t("crumb.back")}
      </button>
      {items.map((x, i) => (
        <span key={`${x.key}-${i}`} className="inline-flex items-center gap-1.5">
          {i > 0 && <ChevronRight size={13} className="text-slate-300" />}
          {x.to && i < items.length - 1 ? (
            <Link to={x.to} className="hover:text-brand-700 hover:underline">
              {t(x.key)}
            </Link>
          ) : (
            <span className="font-medium text-slate-700" aria-current="page">
              {t(x.key)}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
