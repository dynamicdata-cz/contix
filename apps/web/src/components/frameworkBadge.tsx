/** Rámec, podle kterého se modul řídí (ADR-084) – štítek v záhlaví stránky podle regulatorního profilu aktivní společnosti. */
import { useMe } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { useProfile } from "@/lib/regime";
import { doraAuthorityOf, FRAMEWORKS } from "@contix/shared";
import { Scale } from "lucide-react";

const short = (id: string | null) => (id ? (FRAMEWORKS.find((f) => f.id === id)?.shortName ?? id) : null);

/** Popis rámců profilu, např. „Vyhl. 410 · ZKB · NÚKIB“ a „DORA · dohled ČNB“. */
export function useFrameworkLabel(): { main: string; sector: string | null } {
  const t = useT();
  const p = useProfile();
  const parts = [short(p.primary === "dora" && p.doraEntity ? null : p.primary), short(p.law)].filter((x): x is string => !!x);
  if (parts.length && p.authority.length <= 20) parts.push(p.authority);
  const main = parts.length ? parts.join(" · ") : t("fwb.none");
  return { main, sector: p.doraEntity ? t("fwb.dora", { authority: doraAuthorityOf(p) }) : null };
}

export function FrameworkBadge() {
  const t = useT();
  const me = useMe();
  const { main, sector } = useFrameworkLabel();
  // souhrnný pohled skupiny s více společnostmi – profil se liší podle společnosti
  if (!me.activeCompanyId && me.companies.length > 1) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="framework-badge" title={t("fwb.title")}>
      <Scale size={14} className="text-slate-400" />
      {main !== t("fwb.none") || !sector ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{t("fwb.label", { fw: main })}</span> : null}
      {sector && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{sector}</span>}
    </span>
  );
}
