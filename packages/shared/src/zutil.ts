import { z } from "zod";

type StripDefault<T> = T extends z.ZodDefault<infer I> ? I : T;
type StripShape<S extends z.ZodRawShape> = { [K in keyof S]: StripDefault<S[K]> };

/**
 * PATCH schéma z create schématu: odstraní výchozí hodnoty a vše udělá volitelné.
 * (Zod `.partial()` výchozí hodnoty ponechává → PATCH by přepsal neuvedená pole.)
 */
export function patchOf<S extends z.ZodRawShape>(schema: z.ZodObject<S>) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([k, v]) => [k, v instanceof z.ZodDefault ? v.unwrap() : v]),
  ) as unknown as StripShape<S>;
  return z.object(shape).partial();
}
