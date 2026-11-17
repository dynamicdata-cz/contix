/**
 * Výběr s vyhledáváním (v1.74, ADR-167): rozbalí se kliknutím nebo psaním, filtruje bez ohledu na diakritiku,
 * ukáže skupiny (útvar, typ aktiva…), odsazení stromu a doplňující údaj; ovládání šipkami, Enter, Esc.
 * Jedno pole `role="combobox"` – popisek z `Field` (label) i `aria-label` fungují jako u nativního výběru.
 */
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { Check, ChevronDown, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

export interface ComboOption {
  id: string;
  label: string;
  /** Doplňující text vpravo (typ, držitel funkce, hostname…). */
  hint?: string;
  /** Nadpis skupiny – po sobě jdoucí položky stejné skupiny jsou pod jedním nadpisem. */
  group?: string;
  /** Odsazení (strom útvarů). */
  depth?: number;
  /** Ikona / ukazatel před popiskem. */
  icon?: ReactNode;
}

/** Text pro hledání: malá písmena bez diakritiky. */
export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Shoda všech slov dotazu v popisku, doplňku nebo skupině. */
export function comboMatch(o: ComboOption, q: string) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold(`${o.label} ${o.hint ?? ""} ${o.group ?? ""}`);
  return words.every((w) => hay.includes(w));
}

const field =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-8 text-sm text-slate-900 shadow-sm outline-none transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-brand-500 focus:ring-3 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-500";

interface ListProps {
  options: ComboOption[];
  /** Položka „nic“ (prázdný výběr) na začátku seznamu. */
  emptyLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  /** Hledání na serveru: zavolá se s dotazem (seznam `options` pak dodá volající). */
  onQuery?: (q: string) => void;
  /** I s `onQuery` filtrovat seznam podle dotazu na místě (štítky). */
  filterLocal?: boolean;
  /** Rychlé založení (v1.76): nabídne „+ Založit „…““, když napsaný text v seznamu není; vrátí novou položku. */
  onCreate?: (label: string) => Promise<ComboOption | null>;
  loading?: boolean;
  /** Text, když nic neodpovídá. */
  noneText?: string;
  testId?: string;
}

/** Jádro: pole + rozbalovací seznam. `pick(null)` = prázdná položka. */
const CREATE = "__create__";

function useCombo({ options, emptyLabel, onQuery, filterLocal, onCreate, createText }: Pick<ListProps, "options" | "emptyLabel" | "onQuery" | "filterLocal" | "onCreate"> & { createText?: (q: string) => string }, pick: (id: string | null, q: string) => void) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const list = useMemo(() => {
    const f = onQuery && !filterLocal ? options : options.filter((o, i) => (filterLocal && i === 0 && o.id === q.trim() ? true : comboMatch(o, q)));
    const typed = q.trim();
    const canCreate = !!onCreate && typed.length > 1 && !options.some((o) => fold(o.label) === fold(typed));
    return [...(emptyLabel != null && !q ? [{ id: "", label: emptyLabel } as ComboOption] : []), ...f, ...(canCreate ? [{ id: CREATE, label: createText?.(typed) ?? `+ ${typed}` }] : [])];
  }, [options, q, emptyLabel, onQuery, filterLocal, onCreate, createText]);
  useEffect(() => setActive(0), [q, open]);
  const choose = (i: number) => {
    const o = list[i];
    if (!o) return;
    pick(o.id || null, q.trim());
    setOpen(false);
    setQ("");
    onQuery?.("");
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((a) => Math.min(list.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      if (open) {
        e.preventDefault();
        choose(active);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setQ("");
      }
    } else if (e.key === "Tab") setOpen(false);
  };
  return { open, setOpen, q, setQ, active, setActive, list, choose, onKeyDown };
}

function Popup({ id, list, active, setActive, choose, selected, loading, noneText }: { id: string; list: ComboOption[]; active: number; setActive: (i: number) => void; choose: (i: number) => void; selected: Set<string>; loading?: boolean; noneText: string }) {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    ref.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  let lastGroup: string | undefined;
  return (
    <ul ref={ref} id={id} role="listbox" className="absolute z-40 mt-1 max-h-72 w-full min-w-56 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg">
      {loading && <li className="px-3 py-2 text-slate-500">…</li>}
      {!loading && list.length === 0 && <li className="px-3 py-2 text-slate-500">{noneText}</li>}
      {list.map((o, i) => {
        const header = o.group && o.group !== lastGroup ? o.group : null;
        lastGroup = o.group;
        return (
          <li key={`${o.id}:${i}`} role="presentation">
            {header && <div className="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{header}</div>}
            <div
              id={`${id}-${i}`}
              data-i={i}
              role="option"
              aria-selected={selected.has(o.id)}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={(e) => {
                // v <label> (Field) by klik jinak aktivoval pole znovu
                e.preventDefault();
                choose(i);
              }}
              className={cn("flex cursor-pointer items-center gap-2 py-1.5 pr-3", i === active ? "bg-brand-50 text-brand-900" : "text-slate-800", !o.id && "text-slate-500")}
              style={{ paddingLeft: `${0.75 + (o.depth ?? 0) * 1}rem` }}
            >
              {o.icon}
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.hint && <span className="shrink-0 truncate text-xs text-slate-500">{o.hint}</span>}
              {selected.has(o.id) && <Check size={14} className="shrink-0 text-brand-600" aria-hidden />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Jedna hodnota. */
export function Combobox({ value, onChange, ...p }: ListProps & { value: string | null; onChange: (v: string | null) => void }) {
  const t = useT();
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const [created, setCreated] = useState<ComboOption[]>([]);
  const c = useCombo({ ...p, createText: (q) => t("combo.create", { name: q }) }, (id, q) => {
    if (id !== CREATE) return onChange(id);
    void p.onCreate?.(q).then((o) => o && (setCreated((x) => [...x, o]), onChange(o.id)));
  });
  const current = p.options.find((o) => o.id === value) ?? created.find((o) => o.id === value);
  // klik mimo zavře
  useEffect(() => {
    if (!c.open) return;
    const h = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && (c.setOpen(false), c.setQ(""));
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [c.open]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = c.open ? c.q : (current?.label ?? (value ? "…" : ""));
  return (
    <div ref={wrap} className={cn("relative", p.className)} data-testid={p.testId}>
      <input
        role="combobox"
        aria-expanded={c.open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={c.open ? `${id}-list-${c.active}` : undefined}
        aria-label={p.ariaLabel}
        disabled={p.disabled}
        className={field}
        value={shown}
        placeholder={c.open ? (current?.label ?? p.placeholder ?? t("combo.search")) : (p.emptyLabel ?? p.placeholder ?? "")}
        title={current?.hint ? `${current.label} – ${current.hint}` : current?.label}
        onChange={(e) => {
          c.setQ(e.target.value);
          p.onQuery?.(e.target.value);
          c.setOpen(true);
        }}
        onClick={() => c.setOpen(true)}
        onFocus={(e) => e.target.select()}
        onKeyDown={c.onKeyDown}
        autoComplete="off"
      />
      <ChevronDown size={16} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
      {c.open && <Popup id={`${id}-list`} list={c.list} active={c.active} setActive={c.setActive} choose={c.choose} selected={new Set(value ? [value] : [])} loading={p.loading} noneText={p.noneText ?? t("combo.none")} />}
    </div>
  );
}

/** Více hodnot: vybrané jako čipy (volitelně odkazy), přidání výběrem ze seznamu. */
export function ComboMulti({
  value,
  onChange,
  renderChip,
  emptyText,
  ...p
}: Omit<ListProps, "emptyLabel"> & { value: string[]; onChange: (v: string[]) => void; renderChip?: (id: string) => ReactNode; emptyText?: string }) {
  const t = useT();
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const opts = useMemo(() => p.options.filter((o) => !value.includes(o.id)), [p.options, value]);
  const [created, setCreated] = useState<ComboOption[]>([]);
  const c = useCombo({ options: opts, onQuery: p.onQuery, filterLocal: p.filterLocal, onCreate: p.onCreate, createText: (q) => t("combo.create", { name: q }) }, (x, q) => {
    if (x === CREATE) return void p.onCreate?.(q).then((o) => o && (setCreated((y) => [...y, o]), onChange([...value, o.id])));
    if (x) onChange([...value, x]);
  });
  useEffect(() => {
    if (!c.open) return;
    const h = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && (c.setOpen(false), c.setQ(""));
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [c.open]); // eslint-disable-line react-hooks/exhaustive-deps
  const label = (x: string) => p.options.find((o) => o.id === x)?.label ?? created.find((o) => o.id === x)?.label ?? "…";
  return (
    <div ref={wrap} className={p.className} data-testid={p.testId}>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {value.length === 0 && emptyText && <span className="text-sm text-slate-400">{emptyText}</span>}
        {value.map((x) => (
          <span key={x} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-2 pr-1 text-xs">
            {renderChip ? renderChip(x) : label(x)}
            {!p.disabled && (
              // span místo <button>: v <label> (Field) by klik na popisek aktivoval první tlačítko = odebral čip
              <span
                role="button"
                tabIndex={0}
                className="cursor-pointer rounded-full p-0.5 hover:bg-slate-200"
                onClick={(e) => {
                  e.preventDefault();
                  onChange(value.filter((v) => v !== x));
                }}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onChange(value.filter((v) => v !== x)))}
                aria-label={t("combo.remove", { name: label(x) })}
              >
                <X size={12} />
              </span>
            )}
          </span>
        ))}
      </div>
      {!p.disabled && (
        <div className="relative">
          <input
            role="combobox"
            aria-expanded={c.open}
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={c.open ? `${id}-list-${c.active}` : undefined}
            aria-label={p.ariaLabel}
            className={field}
            value={c.q}
            placeholder={p.placeholder ?? t("combo.add")}
            onChange={(e) => {
              c.setQ(e.target.value);
              p.onQuery?.(e.target.value);
              c.setOpen(true);
            }}
            onClick={() => c.setOpen(true)}
            onKeyDown={c.onKeyDown}
            autoComplete="off"
          />
          <ChevronDown size={16} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
          {c.open && <Popup id={`${id}-list`} list={c.list} active={c.active} setActive={c.setActive} choose={c.choose} selected={new Set()} loading={p.loading} noneText={p.noneText ?? t("combo.none")} />}
        </div>
      )}
    </div>
  );
}

/**
 * Volný text s nabídkou (v1.76, ADR-169): napsat lze cokoli, nabídka ukáže odpovídající záznamy z evidence
 * (dodavatelé, lokality…); výběr z nabídky zavolá `onPick` – např. doplní i vazbu na záznam.
 */
export function SuggestInput({
  value,
  onChange,
  suggestions,
  onPick,
  disabled,
  ariaLabel,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestions: ComboOption[];
  onPick?: (o: ComboOption) => void;
  disabled?: boolean;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const list = useMemo(() => suggestions.filter((o) => comboMatch(o, value) && o.label !== value).slice(0, 30), [suggestions, value]);
  useEffect(() => setActive(-1), [value]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const choose = (i: number) => {
    const o = list[i];
    if (!o) return;
    onChange(o.label);
    onPick?.(o);
    setOpen(false);
  };
  return (
    <div ref={wrap} className={cn("relative", className)}>
      <input
        role="combobox"
        aria-expanded={open && list.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${id}-list-${active}` : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        className={field.replace(" pr-8", "")}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(list.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" && open && active >= 0) {
            e.preventDefault();
            choose(active);
          } else if (e.key === "Escape" && open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
        autoComplete="off"
      />
      {open && list.length > 0 && <Popup id={`${id}-list`} list={list} active={active} setActive={setActive} choose={choose} selected={new Set()} noneText="" />}
    </div>
  );
}
