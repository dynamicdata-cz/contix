/**
 * Záložky stránky (v1.06, ADR-102): role tablist/tab, šipky ←/→, Home/End; stav volitelně v adrese (`useTab`).
 */
import { useUrlParam } from "@/lib/urlState";
import { cn } from "@/lib/utils";
import { useRef, type ReactNode } from "react";

export type TabItem<K extends string> = { key: K; label: ReactNode; badge?: ReactNode };

export function Tabs<K extends string>({ items, value, onChange, label, className }: { items: TabItem<K>[]; value: K; onChange: (k: K) => void; label?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const focusAt = (i: number) => {
    const n = items.length;
    const k = items[((i % n) + n) % n]!.key;
    onChange(k);
    ref.current?.querySelector<HTMLButtonElement>(`[data-tab="${k}"]`)?.focus();
  };
  const idx = items.findIndex((x) => x.key === value);
  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={label}
      className={cn("mb-4 flex flex-wrap gap-1 border-b border-slate-200", className)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") focusAt(idx + 1);
        else if (e.key === "ArrowLeft") focusAt(idx - 1);
        else if (e.key === "Home") focusAt(0);
        else if (e.key === "End") focusAt(items.length - 1);
        else return;
        e.preventDefault();
      }}
    >
      {items.map((x) => (
        <button
          key={x.key}
          data-tab={x.key}
          role="tab"
          type="button"
          aria-selected={value === x.key}
          tabIndex={value === x.key ? 0 : -1}
          onClick={() => onChange(x.key)}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300",
            value === x.key ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800",
          )}
        >
          {x.label}
          {x.badge}
        </button>
      ))}
    </div>
  );
}

/** Aktivní záložka v adrese (`?tab=`) – výchozí se do adresy nezapisuje. */
export function useTab<K extends string>(keys: readonly K[], def: K): [K, (k: K) => void] {
  const [raw, set] = useUrlParam<string>("tab", def);
  return [(keys as readonly string[]).includes(raw) ? (raw as K) : def, set as (k: K) => void];
}
