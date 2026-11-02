import { useMe } from "@/lib/auth";
import { czDecreeOf, profileOf, type FrameworkId, type RegulatoryProfile } from "@contix/shared";

/** Regulatorní profil společnosti (aktivní nebo zadané) – ADR-080. Moduly se řídí profilem, nikdy natvrdo 409/410. */
export function useProfile(companyId?: string | null): RegulatoryProfile {
  const me = useMe();
  const id = companyId ?? me.activeCompanyId ?? me.homeCompanyId;
  const co = me.companies.find((c) => c.id === id);
  return profileOf({ regime: co?.regime ?? "higher", pack: co?.pack ?? "cz", primaryFramework: co?.primaryFramework ?? null, doraEntity: co?.doraEntity ?? false });
}

/** Výchozí (hlavní) rámec společnosti pro výběry v UI – vyhláška podle režimu, nebo hlavní rámec z knihovny. */
export function useDecree(companyId?: string | null): FrameworkId {
  return useProfile(companyId).defaultFramework;
}

/** Česká vyhláška pro funkce vázané na její strukturu (šablony dotazníků a smluvních doložek); mimo CZ výchozí 409. */
export function useCzDecree(companyId?: string | null): "cz409" | "cz410" {
  return czDecreeOf(useProfile(companyId)) ?? "cz409";
}
