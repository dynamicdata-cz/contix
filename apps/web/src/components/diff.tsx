import { useT } from "@/lib/i18n";
import type { VersionDiffDto } from "@contix/shared";
import { useState } from "react";

/** Zobrazení rozdílů mezi verzemi dokumentu: přidané zeleně, odebrané přeškrtnuté červeně. */
export function DiffView({ d }: { d: VersionDiffDto }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const total = d.stats.added + d.stats.removed + d.stats.changed;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-slate-600">
          {t("doc.verze3", { version: d.from.version, version2: d.to.version })}
        </span>
        <span className="rounded bg-amber-50 px-1.5 text-amber-900">{t("doc.upraveno", { changed: d.stats.changed })}</span>
        <span className="rounded bg-emerald-50 px-1.5 text-emerald-800">{t("doc.pridano", { added: d.stats.added })}</span>
        <span className="rounded bg-red-50 px-1.5 text-red-800">{t("doc.odebrano", { removed: d.stats.removed })}</span>
        <span className="text-xs text-slate-500">{t("doc.odstavcu")}</span>
        {d.blocks.some((b) => b.type === "same" && b.skipped > 0) && (
          <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" className="accent-brand-600" checked={all} onChange={(e) => setAll(e.target.checked)} /> {t("doc.zobrazitVynechaneNezmeneneCasti")}
          </label>
        )}
      </div>
      {d.missingText.length > 0 && (
        <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {t("doc.porovnaniJeNeuplneTextZatim", { p: d.missingText.join(", ") })}
        </p>
      )}
      {d.truncated && <p className="text-xs text-amber-800">{t("doc.dokumentJeVelmiDlouhyPorovnava")}</p>}
      {total === 0 ? (
        <p className="rounded bg-slate-50 px-3 py-6 text-center text-sm text-slate-600">{t("doc.textObouVerziJeShodny")}</p>
      ) : (
        <div className="max-h-[60vh] space-y-1.5 overflow-y-auto rounded-md border border-slate-200 p-3 text-sm leading-relaxed">
          {d.blocks.map((b, i) =>
            b.type === "same" ? (
              <div key={i} className="text-slate-500">
                {b.head.map((l, k) => (
                  <p key={`h${k}`}>{l}</p>
                ))}
                {b.skipped > 0 && !all && <p className="my-1 text-center text-xs text-slate-400">{t("doc.nezmenenychOdstavcu", { skipped: b.skipped })}</p>}
                {b.tail.map((l, k) => (
                  <p key={`t${k}`}>{l}</p>
                ))}
              </div>
            ) : b.type === "add" ? (
              b.lines.map((l, k) => (
                <p key={`${i}-${k}`} className="rounded bg-emerald-50 px-1.5 text-emerald-900">
                  <span className="sr-only">{t("doc.pridano2")} </span>
                  {l}
                </p>
              ))
            ) : b.type === "del" ? (
              b.lines.map((l, k) => (
                <p key={`${i}-${k}`} className="rounded bg-red-50 px-1.5 text-red-800 line-through decoration-red-400">
                  <span className="sr-only">{t("doc.odebrano2")} </span>
                  {l}
                </p>
              ))
            ) : (
              <p key={i} className="rounded bg-amber-50/60 px-1.5">
                {b.parts.map((p, k) =>
                  p.t === "=" ? (
                    <span key={k}>{p.v}</span>
                  ) : p.t === "+" ? (
                    <ins key={k} className="rounded bg-emerald-100 text-emerald-900 no-underline">
                      {p.v}
                    </ins>
                  ) : (
                    <del key={k} className="rounded bg-red-100 text-red-800 decoration-red-400">
                      {p.v}
                    </del>
                  ),
                )}
              </p>
            ),
          )}
        </div>
      )}
    </div>
  );
}
