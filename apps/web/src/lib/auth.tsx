import type { MeDto, ModuleKey, Permission } from "@contix/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import { ApiError, api } from "./api";

const MeContext = createContext<MeDto | null>(null);

export function useMe(): MeDto {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe mimo přihlášenou část aplikace");
  return me;
}

export function useCan() {
  const me = useMe();
  return (...perms: Permission[]) => perms.some((p) => me.permissions.includes(p));
}

/** Je modul zapnutý (Administrace → Moduly)? */
export function useModule() {
  const me = useMe();
  return (...keys: ModuleKey[]) => keys.every((k) => me.enabledModules.includes(k));
}

export function useMeQuery() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.auth.me();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useRefreshMe() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["me"] });
}

export const MeProvider = ({ me, children }: { me: MeDto; children: ReactNode }) => (
  <MeContext.Provider value={me}>{children}</MeContext.Provider>
);
