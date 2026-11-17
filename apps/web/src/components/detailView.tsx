/**
 * Detail záznamu v režimu čtení (v1.84, sjednocené detaily): přehled místo formuláře, úpravy až po „Upravit“.
 * Stejné stavební prvky pro rizika, opatření, dodavatele a činnosti zpracování (GDPR) – vzor je detail aktiva.
 */
import { Button, Card, CardHeader } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Pencil } from "lucide-react";
import { isValidElement, useLayoutEffect, useRef, type ReactNode } from "react";

/** Popisek a hodnota; prázdná hodnota = pomlčka. */
export function ViewItem({ label, children, wide, className }: { label: ReactNode; children?: ReactNode; wide?: boolean; className?: string }) {
  const emptyProse = isValidElement<{ text?: string | null }>(children) && children.type === Prose && !children.props.text?.trim();
  const empty = children === null || children === undefined || children === "" || children === false || emptyProse;
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-2", className)}>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-800">{empty ? <span className="text-slate-400">—</span> : children}</dd>
    </div>
  );
}

/** Karta s údaji ve dvou sloupcích. */
export function ViewSection({ title, subtitle, action, children, testId, cols = 2 }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; testId?: string; cols?: 1 | 2 }) {
  return (
    <Card data-testid={testId}>
      <CardHeader title={title} subtitle={subtitle} action={action} />
      <dl className={cn("grid gap-x-8 gap-y-4 p-5", cols === 2 && "sm:grid-cols-2")}>{children}</dl>
    </Card>
  );
}

/** Víceřádkový text (popis, zdůvodnění) se zachováním odstavců. */
export function Prose({ text }: { text: string | null | undefined }) {
  if (!text?.trim()) return null;
  return <span className="block whitespace-pre-wrap leading-relaxed">{text}</span>;
}

/** Štítky (aktiva, procesy, opatření…) – prázdný seznam = text `empty`. */
export function Chips({ children, empty }: { children: ReactNode[]; empty?: string }) {
  if (!children.length) return empty ? <span className="text-slate-400">{empty}</span> : null;
  return <span className="flex flex-wrap gap-1.5">{children}</span>;
}
export function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">{children}</span>;
}

/**
 * Tlačítka záhlaví detailu: v přehledu „Upravit“, při úpravách „Zrušit“ a uložení. U nového záznamu jen uložení.
 */
export function EditActions({
  isNew,
  editing,
  canEdit,
  onEdit,
  onCancel,
  onSave,
  saving,
  saveDisabled,
  saveLabel,
}: {
  isNew: boolean;
  editing: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
  saveLabel: string;
}) {
  const t = useT();
  if (!canEdit) return null;
  if (!isNew && !editing)
    return (
      <Button variant="secondary" onClick={onEdit} data-testid="detail-edit">
        <Pencil size={15} /> {t("detail.edit")}
      </Button>
    );
  return (
    <>
      {!isNew && (
        <Button variant="secondary" onClick={onCancel} disabled={saving} data-testid="detail-cancel">
          {t("detail.cancelEdit")}
        </Button>
      )}
      <Button onClick={onSave} disabled={saveDisabled || saving} data-testid="detail-save">
        {saveLabel}
      </Button>
    </>
  );
}

/**
 * Formulář v režimu čtení (v1.84): stejné karty jako při úpravách, ale pole vypadají jako text (bez rámečků,
 * bez rozbalovacích šipek) a ovládací prvky pro úpravy se skryjí. Úpravy až po „Upravit“.
 */
export function FormView({ editing, children, className }: { editing: boolean; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLFieldSetElement>(null);
  // prázdná pole ukázat jako „—“, datum bez masky mm/dd/yyyy, víceřádkový text na výšku obsahu (Safari neumí field-sizing)
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    for (const el of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")) {
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio" || el.type === "file" || el.type === "hidden")) continue;
      if (!editing) {
        if (!el.dataset.ctxPh) el.dataset.ctxPh = el.getAttribute("placeholder") ?? "";
        el.setAttribute("placeholder", "—");
        if (el instanceof HTMLInputElement && /^(date|datetime-local|time|month)$/.test(el.type) && !el.value) {
          el.dataset.ctxType = el.type;
          el.type = "text";
        }
        if (el instanceof HTMLTextAreaElement) {
          el.style.height = "auto";
          el.style.height = `${el.value ? el.scrollHeight : 24}px`;
        }
      } else {
        if (el.dataset.ctxPh !== undefined) {
          if (el.dataset.ctxPh) el.setAttribute("placeholder", el.dataset.ctxPh);
          else el.removeAttribute("placeholder");
          delete el.dataset.ctxPh;
        }
        if (el instanceof HTMLInputElement && el.dataset.ctxType) {
          el.type = el.dataset.ctxType;
          delete el.dataset.ctxType;
        }
        if (el instanceof HTMLTextAreaElement) el.style.height = "";
      }
    }
  });
  return (
    <fieldset ref={ref} disabled={!editing} className={cn("min-w-0", !editing && "ctx-view", className)}>
      {children}
    </fieldset>
  );
}
