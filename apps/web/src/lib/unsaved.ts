/**
 * Hlídání neuložených změn formuláře (v1.06, ADR-102): odchod na jinou stránku nebo zavření okna prohlížeče
 * se před uložením potvrdí. Formulář se označí jako změněný při prvním vstupu (`bind` na obal polí);
 * po úspěšném uložení se stav vynuluje, během ukládání (přesměrování po uložení) se neblokuje.
 */
import { askConfirm } from "@/components/ui/overlay";
import { tt } from "@/lib/i18n";
import { useBlocker } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";

export function useFormGuard(save?: { isPending: boolean; isSuccess: boolean; submittedAt?: number }) {
  const dirty = useRef(false);
  const saving = useRef(false);
  saving.current = !!save?.isPending;
  // uloženo → čistý formulář
  useEffect(() => {
    if (save?.isSuccess) dirty.current = false;
  }, [save?.isSuccess, save?.submittedAt]);
  useBlocker({
    shouldBlockFn: async ({ current, next }) => {
      if (!dirty.current || saving.current || current.pathname === next.pathname) return false;
      const leave = await askConfirm(tt("ui.unsaved.message"), { title: tt("ui.unsaved.title"), confirmLabel: tt("ui.unsaved.leave"), danger: true });
      if (leave) dirty.current = false;
      return !leave;
    },
    enableBeforeUnload: () => dirty.current && !saving.current,
  });
  return useMemo(() => {
    const mark = (e: { target: EventTarget | null }) => {
      // vyhledávací pole a filtry formulář nemění
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("[data-guard-ignore]") || (el as HTMLInputElement | null)?.type === "search") return;
      dirty.current = true;
    };
    return { bind: { onInput: mark, onChange: mark }, reset: () => (dirty.current = false), isDirty: () => dirty.current };
  }, []);
}
