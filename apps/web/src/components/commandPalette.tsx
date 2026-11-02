/**
 * Rychlé hledání a příkazy – Ctrl+K / ⌘K (v1.06, ADR-102).
 * Stránky: položky menu, které uživatel vidí (čte se z vykresleného menu – oprávnění a moduly platí automaticky).
 * Záznamy: `GET /api/search/quick` (jen čitelné evidence). Naposledy otevřené záznamy si pamatuje prohlížeč.
 */
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn, useDebounced } from "@/lib/utils";
import { QUICK_LABELS, type QuickHit } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Clock, CornerDownLeft, FileSearch, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const RECENT_KEY = "contix.recent";
type Item = { key: string; group: "recent" | "page" | "record" | "ai"; label: string; sub?: string | null; badge?: string; go: () => void };

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

function readRecent(): QuickHit[] {
  try {
    return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as QuickHit[]).slice(0, 8);
  } catch {
    return [];
  }
}
function pushRecent(h: QuickHit) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([h, ...readRecent().filter((x) => x.link !== h.link)].slice(0, 8)));
  } catch {
    /* úložiště nedostupné */
  }
}

/** Otevření palety odkudkoli (tlačítko v menu, mobilní lišta). */
export const openCommandPalette = () => window.dispatchEvent(new Event("contix:palette"));

export function CommandPalette({ aiEnabled }: { aiEnabled: boolean }) {
  const t = useT();
  const can = useCan();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const dq = useDebounced(q.trim(), 200);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("contix:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contix:palette", onOpen);
    };
  }, []);
  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  const records = useQuery({ queryKey: ["quick", dq], queryFn: () => api.quickSearch(dq), enabled: open && dq.length >= 2, staleTime: 30_000, placeholderData: (p) => p });
  // stránky z vykresleného menu (jen to, co uživatel smí vidět)
  const pages = useMemo(() => {
    if (!open) return [] as { href: string; label: string }[];
    const seen = new Set<string>();
    return [...document.querySelectorAll<HTMLAnchorElement>("aside nav a[href]")]
      .map((a) => ({ href: a.getAttribute("href")!, label: (a.textContent ?? "").replace(/\d+$/, "").trim() }))
      .filter((x) => x.label && !seen.has(x.href) && seen.add(x.href));
  }, [open]);

  const close = () => setOpen(false);
  const goHit = (h: QuickHit) => {
    pushRecent(h);
    close();
    nav({ to: h.link as never });
  };
  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    const nq = norm(q.trim());
    if (!nq) {
      for (const h of readRecent()) out.push({ key: `r:${h.link}`, group: "recent", label: h.label, badge: t.lbl(QUICK_LABELS[h.kind]), go: () => goHit(h) });
      for (const p of pages.slice(0, 8)) out.push({ key: `p:${p.href}`, group: "page", label: p.label, go: () => (close(), nav({ to: p.href as never })) });
      return out;
    }
    for (const p of pages.filter((x) => norm(x.label).includes(nq)).slice(0, 6)) out.push({ key: `p:${p.href}`, group: "page", label: p.label, go: () => (close(), nav({ to: p.href as never })) });
    if (dq === q.trim()) for (const h of records.data ?? []) out.push({ key: `h:${h.link}`, group: "record", label: h.label, sub: h.sub, badge: t.lbl(QUICK_LABELS[h.kind]), go: () => goHit(h) });
    if (aiEnabled && can("ai:use") && q.trim().length >= 3) out.push({ key: "ai", group: "ai", label: t("pal.askAi", { q: q.trim() }), go: () => (close(), nav({ to: "/ask", search: { q: q.trim() } as never })) });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, dq, pages, records.data, aiEnabled]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);
  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(items.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[sel]?.go();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  const heading: Record<Item["group"], string> = { recent: t("pal.recent"), page: t("pal.pages"), record: t("pal.records"), ai: t("pal.ai") };
  let lastGroup: string | null = null;
  return (
    <div className="fixed inset-0 z-[55] flex items-start justify-center bg-slate-900/40 p-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-label={t("pal.title")} className="w-full max-w-xl overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4">
          <Search size={18} className="shrink-0 text-slate-400" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder={t("pal.placeholder")}
            className="h-12 flex-1 bg-transparent text-sm outline-none"
            role="combobox"
            aria-expanded="true"
            aria-controls="pal-list"
            aria-activedescendant={items[sel] ? `pal-${sel}` : undefined}
            aria-label={t("pal.title")}
          />
          <kbd className="hidden rounded border border-slate-200 px-1.5 text-[11px] text-slate-400 sm:block">Esc</kbd>
        </div>
        <ul ref={list} id="pal-list" role="listbox" className="max-h-[55vh] overflow-y-auto py-1">
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? heading[it.group] : null;
            lastGroup = it.group;
            return (
              <li key={it.key} role="presentation">
                {head && <div className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{head}</div>}
                <div
                  id={`pal-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={i === sel}
                  onMouseMove={() => setSel(i)}
                  onClick={() => it.go()}
                  className={cn("mx-1 flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm", i === sel ? "bg-brand-50 text-brand-800" : "text-slate-700")}
                >
                  {it.group === "recent" ? <Clock size={15} className="shrink-0 text-slate-400" /> : it.group === "page" ? <ArrowRight size={15} className="shrink-0 text-slate-400" /> : it.group === "ai" ? <Sparkles size={15} className="shrink-0 text-violet-500" /> : <FileSearch size={15} className="shrink-0 text-slate-400" />}
                  <span className="min-w-0 flex-1 truncate">
                    {it.label}
                    {it.sub && <span className="ml-2 text-xs text-slate-400">{it.sub}</span>}
                  </span>
                  {it.badge && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{it.badge}</span>}
                  {i === sel && <CornerDownLeft size={13} className="shrink-0 text-slate-400" />}
                </div>
              </li>
            );
          })}
          {!items.length && <li className="px-4 py-6 text-center text-sm text-slate-500">{q.trim().length < 2 ? t("pal.hint") : records.isFetching ? t("common.loading") : t("pal.none")}</li>}
        </ul>
        <div className="flex gap-4 border-t border-slate-100 bg-slate-50 px-4 py-2 text-[11px] text-slate-500">
          <span>↑↓ {t("pal.move")}</span>
          <span>↵ {t("pal.open")}</span>
          <span>Esc {t("pal.close")}</span>
        </div>
      </div>
    </div>
  );
}
