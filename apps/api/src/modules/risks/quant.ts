import { analyzeQuant, type QuantInput, type QuantPolicy, type QuantResult } from "@contix/shared";

/** Cache výsledků simulace (vstup + politika + náklady → výsledek); simulace je deterministická. */
const cache = new Map<string, QuantResult>();
export function quantOf(id: string, q: QuantInput | null | undefined, policy: QuantPolicy, actionsCost?: number | null): QuantResult | null {
  if (!q) return null;
  const key = `${id}|${JSON.stringify(q)}|${JSON.stringify(policy)}|${actionsCost ?? ""}`;
  let r = cache.get(key);
  if (!r) {
    r = analyzeQuant(q, policy, id, actionsCost);
    if (cache.size > 2000) cache.clear();
    cache.set(key, r);
  }
  return r;
}
