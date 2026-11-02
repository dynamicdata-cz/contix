/**
 * Stav filtrů seznamu v adrese stránky (v1.06, ADR-102): návrat z detailu zachová filtr a odkaz lze sdílet.
 * Prázdná / výchozí hodnota se z adresy odebere; zápis nahrazuje položku historie (Zpět nevrací jednotlivé úhozy).
 */
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

export function useUrlParam<T extends string = string>(key: string, def = "" as T): [T, (v: T) => void] {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const nav = useNavigate();
  const raw = search[key];
  const value = (raw === undefined || raw === null ? def : String(raw)) as T;
  const set = useCallback(
    (v: T) => {
      nav({ to: ".", search: ((prev: Record<string, unknown>) => ({ ...prev, [key]: v === def || v === "" ? undefined : v })) as never, replace: true });
    },
    [nav, key, def],
  );
  return [value, set];
}

export function useUrlFlag(key: string): [boolean, (v: boolean) => void] {
  const [v, set] = useUrlParam<string>(key, "");
  return [v === "1" || v === "true", useCallback((b: boolean) => set(b ? "1" : ""), [set])];
}

/** Řazení seznamu v adrese (`?sort=klíč:asc|desc`, v1.09). */
export function useUrlSort<K extends string>(): [{ key: K; dir: "asc" | "desc" } | null, (s: { key: K; dir: "asc" | "desc" } | null) => void] {
  const [raw, set] = useUrlParam<string>("sort", "");
  const [key, dir] = raw.split(":");
  const value = key && (dir === "asc" || dir === "desc") ? { key: key as K, dir: dir as "asc" | "desc" } : null;
  return [value, useCallback((s: { key: K; dir: "asc" | "desc" } | null) => set(s ? `${s.key}:${s.dir}` : ""), [set])];
}

/** Nastaví více parametrů adresy najednou (uložený pohled, reset filtrů). */
export function useUrlBatch(): (patch: Record<string, string | null | undefined>) => void {
  const nav = useNavigate();
  return useCallback(
    (patch) => {
      nav({ to: ".", search: ((prev: Record<string, unknown>) => {
        const next: Record<string, unknown> = { ...prev };
        for (const [k, v] of Object.entries(patch)) next[k] = v ? v : undefined;
        return next;
      }) as never, replace: true });
    },
    [nav],
  );
}
