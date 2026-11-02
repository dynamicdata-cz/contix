/** Výběr rámce (ADR-086): sledované rámce aktivní společnosti nahoře, ostatní v „Další rámce“. */
import { api } from "@/lib/api";
import { useCan, useModule } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { useProfile } from "@/lib/regime";
import { baseFrameworks, FRAMEWORKS, type FrameworkMeta } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { useGroupView } from "@/components/company";

/** Sledované rámce aktivní společnosti (z rozsahu shody, bez oprávnění k opatřením z regulatorního profilu). */
export function useTrackedFrameworks(): Set<string> {
  const can = useCan();
  const mod = useModule();
  const group = useGroupView();
  const profile = useProfile();
  const enabled = can("controls:read") && mod("controls") && !group;
  const q = useQuery({ queryKey: ["controls", "frameworks"], queryFn: api.controls.frameworks, enabled, staleTime: 300_000 });
  const tracked = q.data ? q.data.filter((f) => f.inScope).map((f) => f.id as string) : baseFrameworks(profile);
  return new Set(tracked);
}

/** Položky `<option>` pro výběr rámce – sledované nahoře. `only` omezí nabídku (např. rámce s použitím „audit“). */
export function FrameworkOptions({ label = "short", only }: { label?: "short" | "name"; only?: (f: FrameworkMeta) => boolean }) {
  const t = useT();
  const tracked = useTrackedFrameworks();
  const list = FRAMEWORKS.filter((f) => !only || only(f));
  const text = (f: FrameworkMeta) => (label === "name" ? f.name : f.shortName);
  const top = list.filter((f) => tracked.has(f.id));
  const rest = list.filter((f) => !tracked.has(f.id));
  const opts = (xs: FrameworkMeta[]) =>
    xs.map((f) => (
      <option key={f.id} value={f.id}>
        {text(f)}
      </option>
    ));
  if (!top.length || !rest.length) return <>{opts(list)}</>;
  return (
    <>
      <optgroup label={t("fwo.tracked")}>{opts(top)}</optgroup>
      <optgroup label={t("fwo.other")}>{opts(rest)}</optgroup>
    </>
  );
}
