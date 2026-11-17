/**
 * Rozbalovací nabídka (v1.36, ADR-133): tlačítko + seznam položek (role menu), zavírá se Escape, klikem mimo
 * a po výběru; šipky ↑/↓ mezi položkami. Položka = odkaz (`to`), externí odkaz (`href`) nebo akce (`onClick`).
 */
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";

export type MenuItem = { label: ReactNode; icon?: ReactNode; to?: string; href?: string; onClick?: () => void; danger?: boolean; disabled?: boolean; hint?: ReactNode } | "separator";

export function DropdownMenu({
  button,
  items,
  label,
  align = "end",
  className,
  buttonClassName,
  header,
}: {
  button: ReactNode;
  items: MenuItem[];
  label: string;
  align?: "start" | "end";
  className?: string;
  buttonClassName?: string;
  header?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // první položka dostane fokus
    box.current?.querySelector<HTMLElement>("[role=menuitem]:not([aria-disabled=true])")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const move = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const all = [...(box.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([aria-disabled=true])") ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    all[(i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
  };
  const itemCls = (x: Exclude<MenuItem, "separator">) =>
    cn(
      "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm focus-visible:outline-none",
      x.disabled ? "cursor-not-allowed opacity-50" : x.danger ? "text-red-700 hover:bg-red-50 focus-visible:bg-red-50" : "text-slate-700 hover:bg-slate-100 focus-visible:bg-slate-100",
    );
  const done = () => setOpen(false);
  return (
    <div ref={box} className={cn("relative", className)}>
      <button ref={btn} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)} className={buttonClassName}>
        {button}
      </button>
      {open && (
        <div role="menu" aria-label={label} onKeyDown={move} className={cn("absolute z-50 mt-1.5 min-w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg", align === "end" ? "right-0" : "left-0")}>
          {header}
          {items.map((x, i) =>
            x === "separator" ? (
              <div key={i} role="separator" className="my-1 border-t border-slate-100" />
            ) : x.to && !x.disabled ? (
              <Link key={i} role="menuitem" to={x.to as never} className={itemCls(x)} onClick={done}>
                {x.icon}
                <span className="min-w-0 flex-1">{x.label}</span>
                {x.hint}
              </Link>
            ) : x.href && !x.disabled ? (
              <a key={i} role="menuitem" href={x.href} className={itemCls(x)} onClick={done} target="_blank" rel="noreferrer">
                {x.icon}
                <span className="min-w-0 flex-1">{x.label}</span>
                {x.hint}
              </a>
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                aria-disabled={x.disabled || undefined}
                className={itemCls(x)}
                onClick={() => {
                  if (x.disabled) return;
                  done();
                  x.onClick?.();
                }}
              >
                {x.icon}
                <span className="min-w-0 flex-1">{x.label}</span>
                {x.hint}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
