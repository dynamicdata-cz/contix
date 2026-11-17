/**
 * Minimální UI primitiva ve stylu shadcn/ui.
 * Plnohodnotné shadcn komponenty lze kdykoli doplnit: `bunx shadcn@latest add button dialog table …`
 */
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { DropdownMenu, type MenuItem } from "./menu";
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm shadow-brand-600/20",
  secondary: "bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 shadow-sm",
  ghost: "text-slate-600 hover:bg-slate-100",
  danger: "bg-white text-red-600 border border-red-200 hover:bg-red-50",
};

export function Button({ variant = "primary", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        className,
      )}
      {...p}
    />
  );
}

const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-brand-500 focus:ring-3 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-500";

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input className={cn(field, className)} {...p} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={cn(field, "min-h-20", className)} {...p} />
);
/** Výběr vypadá stejně jako pole (v1.62): vlastní šipka, stejná výška – Safari jinak ignoruje odsazení nativního výběru. */
/**
 * Výběr. Přístupnost (v1.82): výběr bez popisku (filtry v liště nad seznamem) dostane jako přístupný název text
 * první volby („Všechny stavy“…), pokud nemá vlastní `aria-label` ani nadřazený `<label>`.
 */
export function Select({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  const ref = useRef<HTMLSelectElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || el.labels?.length || el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby")) return;
    const first = el.options[0]?.text.trim();
    if (first) el.setAttribute("aria-label", first);
  });
  return <select ref={ref} className={cn(field, "ctx-select", className)} {...p} />;
}

/** Oddíl formuláře uvnitř karty: malý nadpis a obsah (karty s více skupinami polí). */
export function FormSection({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("p-5", className)}>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cn("block min-w-0 space-y-1.5", className)}>
      {/* popisek na jednom řádku (od šířky sm) – pole v řádku mřížky pak lícují; celý text v title */}
      <span className="block text-sm font-medium leading-5 text-slate-700 sm:truncate" title={label}>
        {label}
      </span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const Card = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("rounded-xl border border-slate-200/80 bg-white shadow-[var(--shadow-card)]", className)} {...p} />
);

export function CardHeader({ title, action, subtitle }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-3.5">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[13px] leading-snug text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const badgeTones = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
};
export type Tone = keyof typeof badgeTones;
export const Badge = ({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) => (
  <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", badgeTones[tone])}>{children}</span>
);

export const criticalityTone: Record<string, Tone> = { low: "slate", medium: "blue", high: "amber", critical: "red" };
export const statusLabel: Record<string, string> = { queued: "ve frontě", running: "běží", succeeded: "hotovo", failed: "chyba" }; // překlad: t.lbl()
export const connectorLabel: Record<string, string> = { wazuh: "Wazuh", network_scan: "Síťový sken", csv_import: "Import CSV", netbox: "NetBox" };
export const statusTone: Record<string, Tone> = { queued: "slate", running: "blue", succeeded: "green", failed: "red" };

/** Záhlaví stránky; `sticky` = pevná hlavička detailu záznamu (název, stav, akce) při posouvání (v1.08). */
/**
 * Záhlaví stránky (v1.36, ADR-133): nadpis, jedna hlavní akce (`actions`), vedlejší akce schované v „Další“ (`more`),
 * podsekce modulu jako řádek odkazů (`nav`) – místo řady stejně důležitých tlačítek.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  badge,
  meta,
  sticky,
  more,
  nav,
  facts,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  badge?: ReactNode;
  meta?: ReactNode;
  sticky?: boolean;
  more?: MenuItem[];
  nav?: SubNavItem[];
  /** Klíčové údaje pod nadpisem (v1.38). */
  facts?: FactItem[];
}) {
  const t = useT();
  return (
    <div
      className={cn(
        "mb-6",
        sticky && "sticky top-14 z-20 -mx-4 mb-4 border-b border-slate-200/70 bg-slate-50/85 px-4 py-3 backdrop-blur-md supports-[backdrop-filter]:bg-slate-50/70 md:-mx-8 md:px-8",
      )}
      data-sticky={sticky ? "" : undefined}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-slate-900">{title}</h1>
            {badge}
          </div>
          {subtitle && <p className="mt-1 max-w-3xl text-sm text-slate-500">{subtitle}</p>}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-slate-600">{meta}</div>}
          {facts && <Facts items={facts} />}
        </div>
        {(actions || more?.length) && (
          <div className="flex flex-wrap items-center gap-2">
            {more && more.length > 0 && (
              <DropdownMenu
                label={t("ui.moreActions")}
                buttonClassName="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                button={
                  <>
                    <MoreHorizontal size={16} /> {t("ui.more")}
                  </>
                }
                items={more}
              />
            )}
            {actions}
          </div>
        )}
      </div>
      {nav && nav.length > 0 && <SubNav items={nav} />}
    </div>
  );
}

/** Klíčové údaje záznamu pod nadpisem (v1.38, ADR-135): krátké páry popisek – hodnota v jednom řádku. */
export type FactItem = { label: string; value: ReactNode; tone?: "red" | "amber" } | false | "" | 0 | null | undefined;
export function Facts({ items, className }: { items: FactItem[]; className?: string }) {
  const list = items.filter((x): x is { label: string; value: ReactNode; tone?: "red" | "amber" } => !!x);
  if (!list.length) return null;
  return (
    <dl className={cn("mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm", className)} data-testid="facts">
      {list.map((x) => (
        <div key={x.label} className="min-w-0">
          <dt className="text-xs text-slate-500">{x.label}</dt>
          <dd className={cn("mt-0.5 font-medium", x.tone === "red" ? "text-red-700" : x.tone === "amber" ? "text-amber-700" : "text-slate-800")}>{x.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export type SubNavItem = { to: string; label: string; icon?: ReactNode; exact?: boolean };
/** Podsekce modulu (Registr · Roční hodnocení · Scénáře…) – odkazy, aktivní podle adresy. */
export function SubNav({ items }: { items: SubNavItem[] }) {
  const t = useT();
  return (
    <nav aria-label={t("ui.sections")} className="-mb-1 mt-4 flex gap-1 overflow-x-auto pb-1" data-testid="subnav">
      {items.map((x) => (
        <Link
          key={x.to}
          to={x.to as never}
          activeOptions={{ exact: x.exact ?? false }}
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          activeProps={{ className: "!bg-brand-600 !text-white" }}
        >
          {x.icon}
          {x.label}
        </Link>
      ))}
    </nav>
  );
}

export const ErrorBox = ({ error }: { error: unknown }) =>
  error ? (
    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {error instanceof Error ? error.message : String(error)}
    </div>
  ) : null;

export const SuccessBox = ({ children }: { children: ReactNode }) => (
  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{children}</div>
);

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  // rozepsaný formulář se nezavře kliknutím vedle (v1.06); Escape a ✕ zavírají vždy
  const dirty = useRef(false);
  const downOnBackdrop = useRef(false);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    dirty.current = false;
    const prev = document.activeElement as HTMLElement | null;
    const el = box.current;
    const first = el?.querySelector<HTMLElement>("[data-autofocus], input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled])");
    (first ?? el)?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (!el) return;
      if (e.key === "Escape") {
        // vnořené okno (poslední v DOM) zavírá jen sebe
        const all = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
        if (all[all.length - 1] !== el) return;
        e.preventDefault();
        close.current();
      } else if (e.key === "Tab") {
        const f = [...el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        const i = f.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && (i <= 0 || i === -1)) {
          e.preventDefault();
          f[f.length - 1]!.focus();
        } else if (!e.shiftKey && i === f.length - 1) {
          e.preventDefault();
          f[0]!.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (prev && document.contains(prev)) prev.focus({ preventScroll: true });
    };
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16"
      data-guard-ignore
      onMouseDown={(e) => (downOnBackdrop.current = e.target === e.currentTarget)}
      onMouseUp={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget && !dirty.current) onClose();
        downOnBackdrop.current = false;
      }}
    >
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-label={title}
        aria-modal="true"
        className={cn("w-full rounded-lg bg-white shadow-xl outline-none", wide ? "max-w-3xl" : "max-w-lg")}
        onInput={() => (dirty.current = true)}
        onChange={() => (dirty.current = true)}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300" aria-label={t("common.close")}>
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Checkbox({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn("flex items-start gap-2.5 text-sm", disabled ? "opacity-60" : "cursor-pointer")}>
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-brand-600"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="text-slate-800">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

export const toggle = <T,>(list: T[], v: T, on: boolean) => (on ? [...new Set([...list, v])] : list.filter((x) => x !== v));

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="px-5 py-10 text-center text-sm text-slate-500">{children}</div>;
}

/** Zástupný obsah při načítání (v1.08). */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} aria-hidden />;
}
