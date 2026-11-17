/**
 * Název aktuální stránky pro drobečkovou navigaci (v1.84): `PageHeader` ho nahlásí, `Breadcrumbs` ho ukáže
 * jako poslední položku místo obecného „Detail“ (např. Přehled › Rizika › R-01 Ransomware zastaví výrobu).
 */
import { useSyncExternalStore } from "react";

let current: string | null = null;
const listeners = new Set<() => void>();

export function setPageTitle(title: string | null) {
  if (current === title) return;
  current = title;
  for (const l of listeners) l();
}

export function usePageTitle(): string | null {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => current,
    () => null,
  );
}
