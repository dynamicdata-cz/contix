import { COMPANY_HEADER, type DemoStatusDto } from "@contix/shared";
import { eq, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, requirePerm } from "../../auth/middleware";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { appSettings, companies, users } from "../../db/schema";
import { invalidateCompanies } from "../../auth/scope";
import { DEMO_COMPANY_NAME, seedDemo, type DemoCall } from "../../scripts/demoData";

/* ============================================================
 * Ukázková data z Administrace (v1.81, ADR-174): založení fiktivní společnosti přes stejná API jako z UI
 * (relace přihlášeného administrátora) a úplné odstranění ukázky. Odstranit lze jen společnost označenou
 * jako ukázka (nastavení `demo.companyId`, u dříve založené ukázky podle názvu) – nikdy skutečná data.
 * ============================================================ */

type Ctx = Context<AppEnv>;
export type Dispatch = (req: Request) => Response | Promise<Response>;
const KEY = "demo.companyId";

/** Tabulky se sloupcem company_id, které se mažou s ukázkou (uživatelé ne – ti brání smazání). */
async function companyTables(db: Db): Promise<string[]> {
  const rows = (await db.execute(sql`
    select c.table_name as t from information_schema.columns c
    join information_schema.tables x on x.table_name = c.table_name and x.table_schema = c.table_schema
    where c.table_schema = 'public' and c.column_name = 'company_id' and x.table_type = 'BASE TABLE'
      and c.table_name not in ('companies', 'users')
    order by 1`)) as unknown as { t: string }[];
  return rows.map((r) => r.t);
}

/**
 * Smaže všechna data společnosti a společnost samotnou. Pořadí tabulek se nezná (vazby mezi evidencemi),
 * proto se maže v kolech: tabulka, kterou zatím drží vazba, se zkusí znovu v dalším kole (savepoint).
 */
export async function purgeCompany(db: Db, companyId: string): Promise<{ tables: number }> {
  const [u] = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(eq(users.companyId, companyId));
  if (Number(u?.n ?? 0) > 0) throw new HTTPException(409, { message: "V ukázkové společnosti jsou uživatelé – nejdřív je přesuňte nebo smažte." });
  const all = await companyTables(db);
  let cleared = 0;
  await db.transaction(async (tx) => {
    // stromy (útvary, procesy, složky dokumentů) brání smazání rodiče – nejdřív zrušit vazbu na nadřízený záznam
    for (const t of ["org_units", "processes", "policy_folders"]) await tx.execute(sql`update ${sql.identifier(t)} set parent_id = null where company_id = ${companyId}`);
    let left = all;
    for (let round = 0; left.length && round < 25; round++) {
      const next: string[] = [];
      for (const t of left) {
        try {
          await tx.transaction(async (sp) => {
            await sp.execute(sql`delete from ${sql.identifier(t)} where company_id = ${companyId}`);
          });
          cleared++;
        } catch {
          next.push(t);
        }
      }
      if (next.length === left.length) throw new HTTPException(409, { message: `Ukázku nelze odstranit – data drží vazby z jiných záznamů (${next.slice(0, 5).join(", ")}).` });
      left = next;
    }
    await tx.delete(companies).where(eq(companies.id, companyId));
    await tx.delete(appSettings).where(eq(appSettings.key, KEY));
  });
  invalidateCompanies();
  return { tables: cleared };
}

export function demoRoutes(deps: { db: Db; dispatch: () => Dispatch }) {
  const { db } = deps;

  /** Ukázková společnost: podle uloženého označení, u starší ukázky (příkaz demo:seed) podle názvu. */
  async function demoCompany(): Promise<{ id: string; name: string } | null> {
    const [s] = await db.select().from(appSettings).where(eq(appSettings.key, KEY));
    const id = typeof s?.value === "string" ? s.value : null;
    if (id) {
      const [c] = await db.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.id, id));
      if (c) return c;
    }
    const [byName] = await db.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.name, DEMO_COMPANY_NAME));
    return byName ?? null;
  }

  async function status(): Promise<DemoStatusDto> {
    const c = await demoCompany();
    if (!c) return { exists: false, companyId: null, name: DEMO_COMPANY_NAME, counts: null };
    const n = async (t: string) => Number(((await db.execute(sql`select count(*)::int as n from ${sql.identifier(t)} where company_id = ${c.id}`)) as unknown as { n: number }[])[0]?.n ?? 0);
    return { exists: true, companyId: c.id, name: c.name, counts: { assets: await n("assets"), risks: await n("risks"), processes: await n("processes"), suppliers: await n("suppliers") } };
  }

  const caller = (c: Ctx, companyId?: string): DemoCall => {
    const base = new URL(c.req.url);
    const dispatch = deps.dispatch();
    return async (method, path, body) => {
      const headers: Record<string, string> = { cookie: c.req.header("cookie") ?? "", origin: c.req.header("origin") ?? base.origin, "x-forwarded-for": c.req.header("x-forwarded-for") ?? "" };
      if (companyId) headers[COMPANY_HEADER] = companyId;
      if (body !== undefined) headers["content-type"] = "application/json";
      const res = await dispatch(new Request(`${base.origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
      return { status: res.status, body: await res.json().catch(() => null) };
    };
  };

  return new Hono<AppEnv>()
    .get("/", requirePerm("admin:settings"), async (c) => c.json(await status()))
    .post("/", requirePerm("admin:settings"), async (c) => {
      if (await demoCompany()) throw new HTTPException(409, { message: "Ukázková společnost už existuje." });
      const r = await seedDemo(caller(c), (id) => caller(c, id));
      if (r.companyId)
        await db
          .insert(appSettings)
          .values({ key: KEY, value: r.companyId })
          .onConflictDoUpdate({ target: appSettings.key, set: { value: r.companyId, updatedAt: new Date() } });
      await audit(db, { c, user: currentUser(c), action: "demo.created", entityType: "company", entityId: r.companyId ?? undefined, details: { name: DEMO_COMPANY_NAME, counts: r.counts } });
      return c.json(await status(), 201);
    })
    .delete("/", requirePerm("admin:settings"), async (c) => {
      const d = await demoCompany();
      if (!d) throw new HTTPException(404, { message: "Ukázková společnost neexistuje." });
      const r = await purgeCompany(db, d.id);
      await audit(db, { c, user: currentUser(c), action: "demo.deleted", entityType: "company", entityId: d.id, details: { name: d.name, tables: r.tables } });
      return c.json(await status());
    });
}
