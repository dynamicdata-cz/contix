import { useT } from "@/lib/i18n";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useMe } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { HELP_AUDIENCE_LABELS, helpAudienceOf, helpForRoute, localizeTopic, tourFor, type HelpAudience, type HelpTopic, type Permission } from "@contix/shared";
import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, BookOpen, CircleHelp, Download, Map as MapIcon, Printer, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

/* Nápověda v aplikaci (panel k aktuální obrazovce), úvodní prohlídka a příručka ke stažení. */

const TOUR_KEY = (userId: string) => `contix.tour.v1.${userId}`;
const seen = (userId: string) => {
  try {
    return localStorage.getItem(TOUR_KEY(userId)) === "1";
  } catch {
    return true; // bez úložiště prohlídku nevnucovat
  }
};
const markSeen = (userId: string) => {
  try {
    localStorage.setItem(TOUR_KEY(userId), "1");
  } catch {
    /* prohlížeč bez úložiště */
  }
};

function useAudience(): HelpAudience[] {
  const can = useCan();
  return helpAudienceOf((p) => can(p as Permission));
}

export function HelpWidget() {
  const t = useT();
  const me = useMe();
  const audience = useAudience();
  const [open, setOpen] = useState(false);
  const [tour, setTour] = useState(false);
  // úvodní prohlídka při prvním přihlášení (jednou na uživatele a prohlížeč)
  // externí auditor (jen portál auditora) prohlídku aplikace nepotřebuje
  const externalOnly = me.permissions.length > 0 && me.permissions.every((p) => p === "audits:external");
  useEffect(() => {
    if (!seen(me.user.id) && !externalOnly) setTour(true);
  }, [me.user.id, externalOnly]);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-300"
        aria-label={t("help.title")}
        title={t("help.forScreen")}
      >
        <CircleHelp size={22} />
      </button>
      {open && (
        <HelpDrawer
          audience={audience}
          onClose={() => setOpen(false)}
          onTour={() => {
            setOpen(false);
            setTour(true);
          }}
        />
      )}
      {tour && (
        <Tour
          audience={audience}
          onClose={() => {
            markSeen(me.user.id);
            setTour(false);
          }}
        />
      )}
    </>
  );
}

function HelpDrawer({ audience, onClose, onTour }: { audience: HelpAudience[]; onClose: () => void; onTour: () => void }) {
  const t = useT();
  const me = useMe();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [q, setQ] = useState("");
  const { matched, others } = useMemo(() => {
    const h = helpForRoute(path, audience, me.enabledModules);
    return { matched: h.matched.map((x) => localizeTopic(t, x)), others: h.others.map((x) => localizeTopic(t, x)) };
  }, [path, audience, me.enabledModules, t]);
  const [topic, setTopic] = useState<HelpTopic | null>(matched[0] ?? null);
  const [manualFor, setManualFor] = useState<HelpAudience[]>(audience);
  const term = q.trim().toLowerCase();
  const filter = (list: HelpTopic[]) => (term ? list.filter((tp) => `${tp.title} ${tp.summary} ${tp.body}`.toLowerCase().includes(term)) : list);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const item = (tp: HelpTopic) => (
    <button key={tp.id} onClick={() => setTopic(tp)} className="block w-full rounded-md px-3 py-2 text-left hover:bg-slate-50">
      <div className="text-sm font-medium text-slate-800">{tp.title}</div>
      <div className="text-xs text-slate-500">{tp.summary}</div>
    </button>
  );
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" onMouseDown={onClose}>
      <aside role="dialog" aria-label={t("help.title")} className="flex h-full w-full max-w-md flex-col bg-white shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
          {topic ? (
            <button className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={() => setTopic(null)} aria-label={t("help.back")}>
              <ArrowLeft size={18} />
            </button>
          ) : (
            <BookOpen size={18} className="text-brand-600" />
          )}
          <h2 className="flex-1 font-semibold">{topic ? topic.title : t("help.title")}</h2>
          <button className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={onClose} aria-label={t("common.close")}>
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {topic ? (
            <div className="text-sm text-slate-700 [&_h1]:mt-4 [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:font-semibold">
              <Markdown text={topic.body} />
            </div>
          ) : (
            <>
              <div className="relative mb-4">
                <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
                <input className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm" placeholder={t("help.search")} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
              </div>
              {filter(matched).length > 0 && (
                <>
                  <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("help.thisScreen")}</div>
                  {filter(matched).map(item)}
                </>
              )}
              <div className="mt-3 px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("help.otherTopics")}</div>
              {filter(others).map(item)}
              {term && !filter(matched).length && !filter(others).length && <p className="px-3 text-sm text-slate-500">{t("common.nothingFound")}</p>}
            </>
          )}
        </div>
        <div className="space-y-3 border-t border-slate-100 px-5 py-4">
          <Button variant="secondary" className="w-full justify-center" onClick={onTour}>
            <MapIcon size={15} /> {t("help.startTour")}
          </Button>
          <div className="text-xs font-medium text-slate-600">{t("help.manualFor")}</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {audience.map((a) => (
              <label key={a} className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" className="accent-brand-600" checked={manualFor.includes(a)} onChange={(e) => setManualFor((x) => (e.target.checked ? [...x, a] : x.filter((y) => y !== a)))} />
                {t.dyn(`enum.helpAudience.${a}`, HELP_AUDIENCE_LABELS[a])}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <a className="flex-1" href={api.help.manualUrl("docx", manualFor)}>
              <Button variant="secondary" className="w-full justify-center" disabled={!manualFor.length}>
                <Download size={15} /> {t("my.word")}
              </Button>
            </a>
            <a className="flex-1" href={api.help.manualUrl("html", manualFor)} target="_blank" rel="noreferrer">
              <Button variant="secondary" className="w-full justify-center" disabled={!manualFor.length}>
                <Printer size={15} /> {t("help.print")}
              </Button>
            </a>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Tour({ audience, onClose }: { audience: HelpAudience[]; onClose: () => void }) {
  const t = useT();
  const me = useMe();
  const steps = useMemo(() => tourFor(audience).filter((s) => !s.route || routeVisible(s.route, me.enabledModules)), [audience, me.enabledModules]);
  const [i, setI] = useState(0);
  const step = steps[i]!;
  const last = i === steps.length - 1;
  // zvýraznit položku menu, o které krok mluví
  useEffect(() => {
    const a = step.route ? document.querySelector<HTMLElement>(`aside nav a[href="${step.route}"]`) : null;
    a?.classList.add("ring-2", "ring-brand-400", "ring-offset-1");
    a?.scrollIntoView({ block: "nearest" });
    return () => a?.classList.remove("ring-2", "ring-brand-400", "ring-offset-1");
  }, [step.route]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/30 p-4 sm:items-center" role="dialog" aria-label={t("tour.title")}>
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <div className="mb-1 text-xs text-slate-500">
          {t("tour.title")} · {i + 1} / {steps.length}
        </div>
        <h2 className="text-lg font-semibold">{t.dyn(`tour.${step.id}.title`, step.title)}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">{t.dyn(`tour.${step.id}.text`, step.text)}</p>
        {step.route && (
          <Link to={step.route as never} onClick={onClose} className="mt-2 inline-block text-sm text-brand-700 hover:underline">
            {t("tour.open")}
          </Link>
        )}
        <div className="mt-5 flex items-center gap-2">
          <div className="flex flex-1 gap-1">
            {steps.map((_, k) => (
              <span key={k} className={cn("h-1.5 w-4 rounded-full", k === i ? "bg-brand-600" : "bg-slate-200")} />
            ))}
          </div>
          {!last && (
            <button className="text-sm text-slate-500 hover:underline" onClick={onClose}>
              {t("tour.skip")}
            </button>
          )}
          {i > 0 && (
            <Button variant="secondary" onClick={() => setI(i - 1)}>
              {t("tour.back")}
            </Button>
          )}
          <Button onClick={() => (last ? onClose() : setI(i + 1))}>{last ? t("tour.start") : t("tour.next")}</Button>
        </div>
      </div>
    </div>
  );
}

const ROUTE_MODULE: Record<string, string> = { "/docs": "policies", "/policies": "policies", "/incidents": "incidents", "/risks": "risks" };
const routeVisible = (route: string, modules: string[]) => !ROUTE_MODULE[route] || modules.includes(ROUTE_MODULE[route]!);
