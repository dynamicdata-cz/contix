import type { SubNavItem } from "@/components/ui";
import { useT } from "@/lib/i18n";

/** Podsekce modulu Rizika (v1.36, ADR-133) – stejný řádek v registru i na podstránkách. */
export function useRiskNav(): SubNavItem[] {
  const t = useT();
  return [
    { to: "/risks", label: t("rsk.nav.register"), exact: true },
    { to: "/risks/cycles", label: t("rsk.rocniHodnoceni") },
    { to: "/risks/scenarios", label: t("rsc.button") },
    { to: "/risks/modeling", label: t("tm.nav") },
    { to: "/risks/appetite", label: t("rap.button") },
    { to: "/risks/quant", label: t("rsk.kvantitativne") },
    { to: "/risks/plan", label: t("rsk.planZvladani") },
    { to: "/risks/catalog", label: t("rsk.katalogHrozebAZranitelnosti") },
  ];
}
