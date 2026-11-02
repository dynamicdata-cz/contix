import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { useEffect, useState } from "react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Jazyk pro formát data a čísel – nastavuje I18nProvider podle zvoleného jazyka. */
let fmtLocale = "cs-CZ";
export const setFormatLocale = (l: string) => void (fmtLocale = l === "cs" ? "cs-CZ" : l);
export const formatLocale = () => fmtLocale;

export const fmtDate = (v?: string | null) =>
  v ? new Date(v).toLocaleString(fmtLocale, { dateStyle: "short", timeStyle: "short" }) : "—";

/** Datum bez času (YYYY-MM-DD) → 31. 12. 2026 (cs) / 12/31/2026 (en) – bez posunu časovým pásmem. */
export const fmtDay = (v?: string | null) => {
  if (!v) return "—";
  const [y, m, d] = v.slice(0, 10).split("-").map(Number);
  if (fmtLocale === "cs-CZ") return `${d}. ${m}. ${y}`;
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString(fmtLocale, { timeZone: "UTC", dateStyle: "medium" });
};

/** Česká množná čísla: plural(3, "krok", "kroky", "kroků") → "3 kroky". */
export const plural = (n: number, one: string, few: string, many: string) => `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;

/** Hodnota se zpožděním – hledání při psaní neposílá dotaz na každý úhoz (v1.06). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setV(value), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return v;
}
