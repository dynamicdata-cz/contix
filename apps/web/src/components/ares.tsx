/** Načtení údajů o firmě z ARES podle IČO nebo názvu (ADR-041) – vložený panel ve formuláři, bez dalšího okna. */
import { Button, ErrorBox, Input } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { fmtDay } from "@/lib/utils";
import type { AresSubject } from "@contix/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, Search, X } from "lucide-react";
import { useState } from "react";

export function AresLookup({ initial, onPick, className }: { initial?: string; onPick: (s: AresSubject) => void; className?: string }) {
  const t = useT();
  const status = useQuery({ queryKey: ["ares", "status"], queryFn: api.ares.status, staleTime: 10 * 60_000, retry: false });
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(false);
  const search = useMutation({ mutationFn: (query: string) => api.ares.search(query) });
  if (!status.data?.enabled) return null;
  if (!open)
    return (
      <div className={className}>
        <Button
          type="button"
          variant="secondary"
          className="px-2.5 py-1.5 text-xs"
          onClick={() => {
            setOpen(true);
            setPicked(false);
            const v = (initial ?? "").trim();
            setQ(v);
            if (v.length >= 3) search.mutate(v);
          }}
        >
          <Building2 size={14} /> {t("ares.button")}
        </Button>
        {picked && <span className="ml-2 text-xs text-emerald-700">{t("ares.applied")}</span>}
      </div>
    );
  const list = search.data ?? [];
  return (
    <div className={`rounded-md border border-slate-200 bg-slate-50 p-3 ${className ?? ""}`}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim().length >= 3) search.mutate(q.trim());
        }}
      >
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ares.placeholder")} aria-label={t("ares.placeholder")} />
        <Button type="submit" variant="secondary" disabled={q.trim().length < 3 || search.isPending}>
          <Search size={15} /> {t("ares.search")}
        </Button>
        <Button type="button" variant="ghost" className="px-2" onClick={() => setOpen(false)} aria-label={t("common.close")}>
          <X size={15} />
        </Button>
      </form>
      <p className="mt-1 text-xs text-slate-500">{t("ares.hint")}</p>
      <ErrorBox error={search.error} />
      {search.isSuccess && list.length === 0 && <p className="mt-2 text-sm text-slate-600">{t("ares.none")}</p>}
      {list.length > 0 && (
        <ul className="mt-2 max-h-72 divide-y divide-slate-200 overflow-y-auto rounded-md border border-slate-200 bg-white">
          {list.map((s) => (
            <li key={s.ico} className="flex items-center gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-slate-500">
                  {t("usr.ico")} {s.ico}
                  {s.dic && ` · ${s.dic}`}
                  {s.address && ` · ${s.address}`}
                  {s.dissolvedAt && <span className="ml-1 text-red-700">· {t("ares.dissolved", { date: fmtDay(s.dissolvedAt) })}</span>}
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                className="px-2.5 py-1 text-xs"
                onClick={() => {
                  onPick(s);
                  setPicked(true);
                  setOpen(false);
                }}
              >
                {t("ares.use")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {list.length >= 10 && <p className="mt-1 text-xs text-slate-500">{t("ares.many")}</p>}
    </div>
  );
}
