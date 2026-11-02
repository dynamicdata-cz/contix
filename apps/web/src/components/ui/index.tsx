/**
 * Minimální UI primitiva ve stylu shadcn/ui.
 * Plnohodnotné shadcn komponenty lze kdykoli doplnit: `bunx shadcn@latest add button dialog table …`
 */
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";
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
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select className={cn(field, className)} {...p} />;

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="text-sm font-medium text-slate-700">{label}</span>
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
export const connectorLabel: Record<string, string> = { wazuh: "Wazuh", network_scan: "Síťový sken", csv_import: "Import CSV" };
export const statusTone: Record<string, Tone> = { queued: "slate", running: "blue", succeeded: "green", failed: "red" };

/** Záhlaví stránky; `sticky` = pevná hlavička detailu záznamu (název, stav, akce) při posouvání (v1.08). */
export function PageHeader({ title, subtitle, actions, badge, meta, sticky }: { title: string; subtitle?: string; actions?: ReactNode; badge?: ReactNode; meta?: ReactNode; sticky?: boolean }) {
  return (
    <div
      className={cn(
        "mb-6 flex flex-wrap items-end justify-between gap-4",
        sticky && "sticky top-12 z-20 -mx-4 mb-4 border-b border-slate-200/70 bg-slate-50/85 px-4 py-3 backdrop-blur-md supports-[backdrop-filter]:bg-slate-50/70 md:top-0 md:-mx-8 md:px-8",
      )}
      data-sticky={sticky ? "" : undefined}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-slate-900">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        {meta && <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-slate-600">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
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
