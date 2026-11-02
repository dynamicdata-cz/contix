/**
 * Potvrzovací dialog a krátká oznámení (v1.06, ADR-102) – náhrada `window.confirm` a ručních SuccessBoxů.
 * Imperativní API (`askConfirm`, `toast`) volatelné odkudkoli; vykresluje je `<OverlayHost />` (jednou v rozvržení).
 */
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";

type ConfirmReq = { id: number; message: string; title?: string; confirmLabel?: string; danger?: boolean; resolve: (ok: boolean) => void };
type Toast = { id: number; message: string; tone: "success" | "info" | "error" };
type State = { confirm: ConfirmReq | null; queue: ConfirmReq[]; toasts: Toast[] };

let state: State = { confirm: null, queue: [], toasts: [] };
const subs = new Set<() => void>();
const emit = (s: State) => {
  state = s;
  subs.forEach((f) => f());
};
let seq = 0;

/**
 * Potvrzení akce v dialogu CONTIXu. Bez vykresleného hostitele (testy, veřejné stránky) se použije `window.confirm`.
 * Výchozí tlačítko „Potvrdit“; u mazání předejte `danger: true`.
 */
export function askConfirm(message: string, opts: { title?: string; confirmLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  if (!hostMounted) return Promise.resolve(window.confirm(message));
  const danger = opts.danger ?? /smaz|odebr|odstran|zruš|delete|remove/i.test(message);
  return new Promise((resolve) => {
    const req: ConfirmReq = { id: ++seq, message, ...opts, danger, resolve };
    emit(state.confirm ? { ...state, queue: [...state.queue, req] } : { ...state, confirm: req });
  });
}

/** Krátké oznámení vpravo dole (zmizí samo). */
export function toast(message: string, tone: Toast["tone"] = "success") {
  const id = ++seq;
  emit({ ...state, toasts: [...state.toasts.slice(-3), { id, message, tone }] });
  setTimeout(() => emit({ ...state, toasts: state.toasts.filter((x) => x.id !== id) }), tone === "error" ? 8000 : 4000);
}

function settle(ok: boolean) {
  const c = state.confirm;
  if (!c) return;
  const [next, ...rest] = state.queue;
  emit({ ...state, confirm: next ?? null, queue: rest });
  c.resolve(ok);
}

let hostMounted = 0;

export function OverlayHost() {
  const s = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
  useEffect(() => {
    hostMounted++;
    return () => {
      hostMounted--;
    };
  }, []);
  return (
    <>
      {s.confirm && <ConfirmDialog key={s.confirm.id} req={s.confirm} />}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite" role="status">
        {s.toasts.map((x) => (
          <div
            key={x.id}
            className={cn(
              "pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm shadow-lg",
              x.tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-900",
              x.tone === "info" && "border-slate-200 bg-white text-slate-800",
              x.tone === "error" && "border-red-200 bg-red-50 text-red-900",
            )}
          >
            {x.tone === "success" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : x.tone === "error" ? <TriangleAlert size={16} className="mt-0.5 shrink-0" /> : <Info size={16} className="mt-0.5 shrink-0" />}
            <span className="flex-1">{x.message}</span>
            <button type="button" className="rounded p-0.5 opacity-60 hover:opacity-100" onClick={() => emit({ ...state, toasts: state.toasts.filter((y) => y.id !== x.id) })} aria-label="✕">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function ConfirmDialog({ req }: { req: ConfirmReq }) {
  const t = useT();
  const ok = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    // u nevratných akcí výchozí fokus na „Zrušit“, jinak na potvrzení
    (req.danger ? cancel : ok).current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        settle(false);
      } else if (e.key === "Tab") {
        // fokus zůstává v dialogu
        const els = [cancel.current, ok.current].filter(Boolean) as HTMLElement[];
        const i = els.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        els[(i + (e.shiftKey ? els.length - 1 : 1)) % els.length]?.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [req]);
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-slate-900/40 p-4 pt-32">
      <div role="alertdialog" aria-modal="true" aria-labelledby={`cf-${req.id}`} aria-describedby={`cfd-${req.id}`} className="w-full max-w-md rounded-lg bg-white shadow-xl">
        <div className="flex gap-3 px-5 pb-3 pt-5">
          {req.danger && <TriangleAlert className="mt-0.5 shrink-0 text-red-600" size={20} />}
          <div className="min-w-0">
            <h2 id={`cf-${req.id}`} className="font-semibold text-slate-900">
              {req.title ?? t("ui.confirm.title")}
            </h2>
            <p id={`cfd-${req.id}`} className="mt-1 whitespace-pre-line text-sm text-slate-600">
              {req.message}
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button ref={cancel} type="button" onClick={() => settle(false)} className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:outline-none">
            {t("ui.confirm.cancel")}
          </button>
          <button
            ref={ok}
            type="button"
            onClick={() => settle(true)}
            className={cn(
              "rounded-md px-3.5 py-2 text-sm font-medium shadow-sm focus-visible:outline-none focus-visible:ring-2",
              req.danger ? "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-300" : "bg-brand-600 text-white hover:bg-brand-700 focus-visible:ring-brand-300",
            )}
          >
            {req.confirmLabel ?? (req.danger ? t("ui.confirm.danger") : t("ui.confirm.ok"))}
          </button>
        </div>
      </div>
    </div>
  );
}
