import { Badge, Button, Input } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { TagEntity } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Tag, X } from "lucide-react";
import { useMemo, useState } from "react";
import { ComboMulti, type ComboOption } from "@/components/combobox";

/** Štítky záznamu ze společného katalogu (v1.52, ADR-149). */
export function TagBar({ entityType, entityId, canEdit }: { entityType: TagEntity; entityId: string; canEdit: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["tags", "of", entityType, entityId], queryFn: () => api.tags.of(entityType, entityId) });
  const catalog = useQuery({ queryKey: ["tags"], queryFn: api.tags.list, enabled: canEdit });
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const set = useMutation({
    mutationFn: (names: string[]) => api.tags.set(entityType, entityId, names),
    onSuccess: (names) => {
      qc.setQueryData(["tags", "of", entityType, entityId], names);
      qc.invalidateQueries({ queryKey: ["tags"], exact: true });
      setValue("");
      setAdding(false);
    },
  });
  const tags = q.data ?? [];
  const byName = new Map((catalog.data ?? []).map((c) => [c.name.toLowerCase(), c]));
  if (!tags.length && !canEdit) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5" data-testid="tag-bar">
      <Tag size={14} className="text-slate-400" aria-hidden />
      {tags.map((n) => (
        <span key={n} className="inline-flex items-center gap-1">
          <Badge tone={(byName.get(n.toLowerCase())?.color as "slate") ?? "slate"}>{n}</Badge>
          {canEdit && (
            <button className="text-slate-400 hover:text-red-600" aria-label={t("tag.remove", { name: n })} onClick={() => set.mutate(tags.filter((x) => x !== n))}>
              <X size={12} />
            </button>
          )}
        </span>
      ))}
      {canEdit &&
        (adding ? (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (value.trim()) set.mutate([...tags, value.trim()]);
            }}
          >
            <Input className="h-7 w-48 py-0 text-xs" autoFocus list="tag-catalog" aria-label={t("tag.new")} value={value} onChange={(e) => setValue(e.target.value)} />
            <datalist id="tag-catalog">
              {(catalog.data ?? []).filter((c) => !tags.some((x) => x.toLowerCase() === c.name.toLowerCase())).map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
            <Button variant="secondary" className="px-2 py-1 text-xs" type="submit" disabled={!value.trim() || set.isPending}>
              {t("tag.add")}
            </Button>
          </form>
        ) : (
          <button className="text-xs text-brand-700 hover:underline" onClick={() => setAdding(true)}>
            + {t("tag.add")}
          </button>
        ))}
      <Link to="/tags" className="ml-1 text-xs text-slate-400 hover:text-brand-700">
        {t("tag.all")}
      </Link>
    </div>
  );
}

/**
 * Štítky ve formuláři (v1.74, ADR-167): výběr z katalogu s vyhledáváním, nový štítek napsáním a Enter.
 * Hodnota = názvy štítků; server je zapíše v pravopisu katalogu (chybějící do katalogu založí).
 */
export function TagInput({ value, onChange, disabled, ariaLabel }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean; ariaLabel?: string }) {
  const t = useT();
  const catalog = useQuery({ queryKey: ["tags"], queryFn: api.tags.list, staleTime: 60_000 });
  const [q, setQ] = useState("");
  const has = (n: string) => value.some((x) => x.toLowerCase() === n.toLowerCase());
  const options: ComboOption[] = useMemo(() => {
    const cat = (catalog.data ?? []).filter((c) => !has(c.name)).map((c) => ({ id: c.name, label: c.name, hint: c.count ? String(c.count) : undefined }));
    const typed = q.trim();
    const exists = typed && (catalog.data ?? []).some((c) => c.name.toLowerCase() === typed.toLowerCase());
    return [...(typed && !exists && !has(typed) ? [{ id: typed, label: t("tag.createNew", { name: typed }) }] : []), ...cat];
  }, [catalog.data, q, value]); // eslint-disable-line react-hooks/exhaustive-deps
  const byName = new Map((catalog.data ?? []).map((c) => [c.name.toLowerCase(), c]));
  return (
    <ComboMulti
      value={value}
      onChange={(v) => {
        onChange(v);
        setQ("");
      }}
      options={[...options, ...value.map((n) => ({ id: n, label: n }))]}
      onQuery={setQ}
      disabled={disabled}
      ariaLabel={ariaLabel ?? t("tag.new")}
      placeholder={t("tag.searchOrCreate")}
      emptyText={t("tag.none")}
      renderChip={(n) => <Badge tone={(byName.get(n.toLowerCase())?.color as "slate") ?? "slate"}>{n}</Badge>}
      filterLocal
    />
  );
}
